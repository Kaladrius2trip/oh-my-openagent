import { BUILTIN_PRESETS, DEFAULT_PRESET_NAME, resolveMoAResearchToolWhitelist, type MoAConfig, type MoAConsultRequest, type MoAPresetConfig, type MoARunStatus, type MoATarget, validatePreset } from "@oh-my-opencode/moa-core"
import { MOA_CONSULTATION_LAUNCH_CONTROLS, MOA_RESEARCH_LAUNCH_CONTROLS, type MoAChildHandle, type MoAChildResult, type MoAChildWaitTimeouts, type MoAExecutionAdapter, type ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import { buildSanitizedContext, type MoAContextMessage } from "@oh-my-opencode/moa-core/context"
import { evaluateConfiguredDiversity, evaluateEffectiveDiversity, type MoADiversityCheck } from "@oh-my-opencode/moa-core/diversity"
import { DEFAULT_PROMPT_PACK_ID, composeAdvisorPrompt, composeAggregatorPrompt, resolvePromptPack } from "@oh-my-opencode/moa-core/prompts"
import { assertTransition, computeTerminalStatus, isTerminalStatus } from "@oh-my-opencode/moa-core/state"

export type MoARunRequest = MoAConsultRequest

export interface MoAParentContext {
  readonly sessionID: string
  readonly messageID: string
  readonly agent?: string
  readonly directory?: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly messages?: readonly MoAContextMessage[]
}

export interface MoARunResult {
  readonly runId: string
  readonly status: MoARunStatus
  readonly synthesis?: string
  readonly advisorResults: readonly MoAChildResult[]
  readonly configuredDiversity?: MoADiversityCheck
  readonly effectiveDiversity?: MoADiversityCheck
  readonly error?: string
}

export interface MoARunSnapshot {
  readonly runId: string
  readonly status: MoARunStatus
  readonly presetName: string
}

export interface MoAManager {
  run(request: MoARunRequest, context: MoAParentContext): Promise<MoARunResult>
  cancel(runId: string, reason: string): Promise<boolean>
  getRun(runId: string): MoARunSnapshot | undefined
  shutdown(): Promise<void>
}

interface ActiveRun {
  readonly runId: string
  readonly presetName: string
  status: MoARunStatus
  readonly controller: AbortController
  readonly adapter: MoAExecutionAdapter
  readonly handles: MoAChildHandle[]
}

export class MoARunError extends Error {
  constructor(readonly presetName: string, message: string) {
    super(message)
    this.name = "MoARunError"
  }
}

const DEFAULT_CHILD_TIMEOUT_MS = 150_000
const DEFAULT_IDLE_WINDOW_MS = 60_000

function childWaitTimeouts(preset: MoAPresetConfig, baseMs: number): MoAChildWaitTimeouts {
  return {
    baseMs,
    idleWindowMs: preset.idle_window_ms ?? DEFAULT_IDLE_WINDOW_MS,
    maxWallMs: preset.max_wall_ms ?? baseMs * 4,
  }
}

function targetLabel(target: MoATarget): string {
  return "category" in target ? `category:${target.category}` : `subagent:${target.subagent_type}`
}

function modelLabel(target: ResolvedMoATarget): string {
  return `${target.model.providerID}/${target.model.modelID}`
}

function transition(run: ActiveRun, status: MoARunStatus): void {
  if (run.status === status) return
  assertTransition(run.status, status)
  run.status = status
}

function resolvePreset(config: MoAConfig, name: string): MoAPresetConfig {
  const preset = config.presets?.[name] ?? BUILTIN_PRESETS[name]
  if (preset === undefined) throw new MoARunError(name, `Unknown MoA preset: ${name}`)
  if (preset.enabled === false) throw new MoARunError(name, `MoA preset is disabled: ${name}`)
  const errors = validatePreset(preset, { maxAdvisors: config.max_advisors_per_run })
  if (errors.length > 0) throw new MoARunError(name, errors.map((error) => error.message).join("; "))
  return preset
}

function result(run: ActiveRun, advisors: readonly MoAChildResult[], extra: Omit<MoARunResult, "runId" | "status" | "advisorResults"> = {}): MoARunResult {
  return { runId: run.runId, status: run.status, advisorResults: advisors, ...extra }
}

async function launchAdvisors(
  run: ActiveRun,
  preset: MoAPresetConfig,
  targets: readonly ResolvedMoATarget[],
  prompts: readonly string[],
): Promise<MoAChildHandle[]> {
  return Promise.all(preset.advisors.map(async (slot, index) => {
    const target = targets[index]
    const prompt = prompts[index]
    if (target === undefined || prompt === undefined) throw new MoARunError(run.presetName, `Missing resolved advisor target at index ${index}`)
    const handle = await run.adapter.launchChild({
      role: "advisor",
      target,
      prompt,
      ...(slot.tool_policy === "read_only" ? MOA_RESEARCH_LAUNCH_CONTROLS : MOA_CONSULTATION_LAUNCH_CONTROLS),
      orchestration: { kind: "moa", runId: run.runId, role: "advisor", slot: slot.name },
      ...(slot.temperature !== undefined ? { temperature: slot.temperature } : {}),
      ...(slot.maxTokens !== undefined ? { maxTokens: slot.maxTokens } : {}),
    })
    run.handles.push(handle)
    if (run.controller.signal.aborted) await run.adapter.cancelChild(handle, "run cancelled during launch")
    return handle
  }))
}

async function settleAdvisors(run: ActiveRun, handles: readonly MoAChildHandle[], preset: MoAPresetConfig): Promise<MoAChildResult[]> {
  const timeouts = childWaitTimeouts(preset, preset.advisor_timeout_ms ?? DEFAULT_CHILD_TIMEOUT_MS)
  return Promise.all(handles.map((handle) => run.adapter.waitForChild(
    handle,
    timeouts,
    run.controller.signal,
  )))
}

export function createMoAManager(options: {
  readonly config: MoAConfig
  readonly createAdapter: (context: MoAParentContext) => MoAExecutionAdapter
  readonly createRunId?: () => string
}): MoAManager {
  const runs = new Map<string, ActiveRun>()
  const createRunId = options.createRunId ?? (() => crypto.randomUUID())

  const run = async (request: MoARunRequest, context: MoAParentContext): Promise<MoARunResult> => {
    const presetName = request.preset ?? options.config.default_preset ?? DEFAULT_PRESET_NAME
    const active: ActiveRun = {
      runId: createRunId(), presetName, status: "created", controller: new AbortController(),
      adapter: options.createAdapter(request.directory === undefined ? context : { ...context, directory: request.directory }), handles: [],
    }
    runs.set(active.runId, active)
    let advisorResults: MoAChildResult[] = []
    try {
      transition(active, "resolving")
      const preset = resolvePreset(options.config, presetName)
      const packId = preset.prompt_pack ?? options.config.default_prompt_pack ?? DEFAULT_PROMPT_PACK_ID
      const pack = resolvePromptPack(packId, { extraPacks: options.config.prompt_packs })
      const boundedContext = buildSanitizedContext({ config: preset.context ?? {}, messages: context.messages ?? [] })
      const researchToolWhitelist = resolveMoAResearchToolWhitelist(options.config)
      const [advisorTargets, aggregatorTarget] = await Promise.all([
        Promise.all(preset.advisors.map(async (slot) => {
          const target = await active.adapter.resolveTarget(slot)
          return slot.tool_policy === "read_only" ? { ...target, researchToolWhitelist } : target
        })),
        active.adapter.resolveTarget(preset.aggregator),
      ])
      if (active.controller.signal.aborted) return result(active, advisorResults)
      const configured = evaluateConfiguredDiversity(advisorTargets.map((target) => target.model), preset.diversity ?? {})
      if (configured.outcome === "failed") {
        transition(active, "failed")
        return result(active, advisorResults, { configuredDiversity: configured, error: configured.warning })
      }

      transition(active, "advising")
      const advisorPrompts = preset.advisors.map((slot) => composeAdvisorPrompt(pack, {
        runId: active.runId, presetName, advisorName: slot.name, role: slot.role ?? "general",
        mode: slot.mode ?? "analysis", requestedTarget: targetLabel(slot), originalTask: request.prompt,
        context: boundedContext,
        toolPolicy: slot.tool_policy ?? "none",
        ...(request.constraints !== undefined ? { constraints: request.constraints } : {}),
        ...(slot.prompt_append !== undefined ? { promptAppend: slot.prompt_append } : {}),
      }).text)
      const handles = await launchAdvisors(active, preset, advisorTargets, advisorPrompts)
      if (active.controller.signal.aborted) return result(active, advisorResults)
      advisorResults = await settleAdvisors(active, handles, preset)
      if (active.controller.signal.aborted) return result(active, advisorResults)
      const successful = advisorResults.filter((advisor) => advisor.status === "completed").length
      const threshold = preset.min_successful_advisors ?? preset.advisors.length
      if (successful < threshold) {
        await Promise.all(advisorResults.map((advisor) => advisor.status === "timed_out"
          ? active.adapter.cancelChild(advisor.handle, "advisor deadline exceeded")
          : Promise.resolve()))
        transition(active, advisorResults.some((advisor) => advisor.status === "timed_out") ? "timed_out" : "failed")
        return result(active, advisorResults, { configuredDiversity: configured })
      }

      const settlements = advisorResults.map((advisor, index) => ({
        name: preset.advisors[index]?.name ?? `advisor-${index + 1}`,
        status: advisor.status,
        model: advisor.finalModel,
      }))
      const effective = evaluateEffectiveDiversity(settlements, preset.diversity ?? {})
      if (effective.outcome === "failed") {
        transition(active, "failed")
        return result(active, advisorResults, { configuredDiversity: configured, effectiveDiversity: effective, error: effective.warning })
      }

      transition(active, "aggregating")
      const aggregatePrompt = composeAggregatorPrompt(pack, {
        runId: active.runId, presetName, promptPackId: packId, aggregatorTarget: targetLabel(preset.aggregator),
        originalTask: request.prompt, context: boundedContext,
        diversity: {
          configuredProviders: configured.counts.providers, effectiveProviders: effective.counts.providers,
          configuredModels: configured.counts.models, effectiveModels: effective.counts.models, outcome: effective.outcome,
        },
        advisorReports: advisorResults.map((advisor, index) => ({
          name: preset.advisors[index]?.name ?? `advisor-${index + 1}`,
          role: preset.advisors[index]?.role ?? "general", status: advisor.status,
          requestedModel: modelLabel(advisorTargets[index] ?? aggregatorTarget),
          finalModel: `${advisor.finalModel.providerID}/${advisor.finalModel.modelID}`,
          fallbackCount: advisor.fallbackCount,
          ...(advisor.output !== undefined ? { output: advisor.output } : {}),
          ...(advisor.errorCategory !== undefined ? { errorCategory: advisor.errorCategory } : {}),
        })),
        ...(request.constraints !== undefined ? { constraints: request.constraints } : {}),
        ...(preset.aggregator.prompt_append !== undefined ? { promptAppend: preset.aggregator.prompt_append } : {}),
      }).text
      const aggregator = await active.adapter.launchChild({
        role: "aggregator", target: aggregatorTarget, prompt: aggregatePrompt,
        ...MOA_CONSULTATION_LAUNCH_CONTROLS,
        orchestration: { kind: "moa", runId: active.runId, role: "aggregator" },
        ...(preset.aggregator.temperature !== undefined ? { temperature: preset.aggregator.temperature } : {}),
        ...(preset.aggregator.maxTokens !== undefined ? { maxTokens: preset.aggregator.maxTokens } : {}),
      })
      active.handles.push(aggregator)
      const aggregate = await active.adapter.waitForChild(
        aggregator,
        childWaitTimeouts(preset, preset.aggregator_timeout_ms ?? DEFAULT_CHILD_TIMEOUT_MS),
        active.controller.signal,
      )
      if (aggregate.status === "timed_out") {
        await active.adapter.cancelChild(aggregator, "aggregator deadline exceeded")
      }
      const terminal = computeTerminalStatus({
        cancelled: active.controller.signal.aborted, advisorThresholdMet: true,
        allAdvisorsSucceeded: successful === preset.advisors.length, effectiveDiversity: effective.outcome,
        aggregatorLaunched: true, aggregatorSucceeded: aggregate.status === "completed",
        allowDegradedBundle: preset.return_advisor_outputs === true, aggregatorTimedOut: aggregate.status === "timed_out",
      })
      transition(active, terminal)
      return result(active, advisorResults, {
        ...(aggregate.output !== undefined ? { synthesis: aggregate.output } : {}),
        configuredDiversity: configured, effectiveDiversity: effective,
      })
    } catch (error) {
      if (isTerminalStatus(active.status)) return result(active, advisorResults)
      await Promise.all(active.handles.map((handle) => active.adapter.cancelChild(handle, "MoA run failed")))
      if (error instanceof Error) {
        transition(active, "failed")
        return result(active, advisorResults, { error: error.message })
      }
      throw error
    }
  }

  return {
    run,
    cancel: async (runId, reason) => {
      const active = runs.get(runId)
      if (active === undefined || isTerminalStatus(active.status)) return false
      active.controller.abort(reason)
      transition(active, "cancelled")
      await Promise.all(active.handles.map((handle) => active.adapter.cancelChild(handle, reason)))
      return true
    },
    getRun: (runId) => {
      const active = runs.get(runId)
      return active === undefined ? undefined : { runId: active.runId, status: active.status, presetName: active.presetName }
    },
    shutdown: async () => {
      const activeRuns = [...runs.values()].filter((active) => !isTerminalStatus(active.status))
      for (const active of activeRuns) {
        active.controller.abort("MoA manager shutdown")
        transition(active, "cancelled")
      }
      await Promise.all(activeRuns.flatMap((active) => active.handles.map((handle) =>
        active.adapter.cancelChild(handle, "MoA manager shutdown"))))
    },
  }
}

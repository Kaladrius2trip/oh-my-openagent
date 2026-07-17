import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DECISION_BUNDLE_HEADINGS, validateDecisionBundle } from "@oh-my-opencode/moa-core"
import type { MoAConfig, MoAResolvedModel, MoATarget } from "@oh-my-opencode/moa-core"
import { MoAConfigSchema } from "@oh-my-opencode/moa-core/config"
import type {
  MoAChildHandle,
  MoAChildLaunchInput,
  MoAChildResult,
  MoAExecutionAdapter,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"

import { loadBuiltinCommands } from "../../../packages/omo-opencode/src/features/builtin-commands/commands"
import { normalizeMoAConfig } from "../../../packages/omo-opencode/src/features/moa/config-normalization"
import { createMoAManager } from "../../../packages/omo-opencode/src/features/moa/moa-manager"
import { createMoaToolsRecord } from "../../../packages/omo-opencode/src/plugin/tool-registry-moa-tools"
import { createMoaConsultTool } from "../../../packages/omo-opencode/src/tools/moa-consult/tool"

const RESOLVED: Readonly<Record<string, Omit<ResolvedMoATarget, "requested">>> = {
  "qa-anthropic": { agent: "oracle", category: "qa-anthropic", model: { providerID: "anthropic", modelID: "claude-opus-4-7" }, fallbackChain: [] },
  "qa-openai": { agent: "oracle", category: "qa-openai", model: { providerID: "openai", modelID: "gpt-5.5" }, fallbackChain: [] },
  "qa-google": { agent: "oracle", category: "qa-google", model: { providerID: "google", modelID: "gemini-3.1-pro" }, fallbackChain: [] },
}

const DECISION_BUNDLE = DECISION_BUNDLE_HEADINGS.map((heading) => `${heading}\nQA content for ${heading.slice(3)}.`).join("\n\n")

class FakeAdapter implements MoAExecutionAdapter {
  readonly launches: MoAChildLaunchInput[] = []
  private readonly modelByTask = new Map<string, MoAResolvedModel>()

  resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
    if (!("category" in target)) throw new Error("QA only defines category targets")
    const resolved = RESOLVED[target.category]
    if (resolved === undefined) throw new Error(`Unknown QA target: ${target.category}`)
    return Promise.resolve({ requested: target, ...resolved })
  }

  launchChild(input: MoAChildLaunchInput): Promise<MoAChildHandle> {
    this.launches.push(input)
    const taskId = `qa-task-${this.launches.length}`
    this.modelByTask.set(taskId, input.target.model)
    return Promise.resolve({ taskId, role: input.role, ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}) })
  }

  waitForChild(handle: MoAChildHandle): Promise<MoAChildResult> {
    const model = this.modelByTask.get(handle.taskId)
    if (model === undefined) throw new Error(`Missing model for ${handle.taskId}`)
    const output = handle.role === "aggregator" ? DECISION_BUNDLE : `Advisor report from ${handle.slot ?? "advisor"}.`
    return Promise.resolve({ handle, status: "completed", output, finalModel: model, fallbackCount: 0 })
  }

  cancelChild(): Promise<void> {
    return Promise.resolve()
  }
}

function snapshotFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

const rawMoa = {
  enabled: true,
  default_preset: "qa",
  max_advisors_per_run: 2,
  presets: {
    qa: {
      execution_policy: "consultation_only",
      advisors: [
        { name: "architect", role: "architect", mode: "analysis", category: "qa-anthropic", tool_policy: "none" },
        { name: "challenger", role: "challenger", mode: "analysis", category: "qa-openai", tool_policy: "none" },
      ],
      aggregator: { category: "qa-google" },
      diversity: { min_distinct_providers: 2, min_distinct_models: 2, on_configured_violation: "fail", on_effective_violation: "degrade" },
      min_successful_advisors: 2,
      advisor_timeout_ms: 2_000,
      aggregator_timeout_ms: 2_000,
    },
  },
}

const sandbox = mkdtempSync(join(tmpdir(), "moa-pr4-tool-"))

try {
  const parsedMoa = MoAConfigSchema.parse(rawMoa)
  const config: MoAConfig = normalizeMoAConfig(parsedMoa)

  const adapter = new FakeAdapter()
  const moaManager = createMoAManager({ config, createRunId: () => "qa-tool-run", createAdapter: () => adapter })

  // Gate proofs: registry tool record and builtin command, enabled vs disabled.
  const enabledRecord = createMoaToolsRecord({ pluginConfig: { moa: parsedMoa }, managers: { moaManager }, factories: { createMoaConsultTool } })
  const disabledRecord = createMoaToolsRecord({ pluginConfig: { moa: { enabled: false } }, managers: { moaManager }, factories: { createMoaConsultTool } })
  const enabledNoManagerRecord = createMoaToolsRecord({ pluginConfig: { moa: parsedMoa }, managers: {}, factories: { createMoaConsultTool } })
  const enabledCommands = loadBuiltinCommands(undefined, { moaEnabled: true })
  const disabledCommands = loadBuiltinCommands(undefined, { moaEnabled: false })

  // Tool run: real tool -> real manager -> fake execution adapter (external models forbidden).
  const moaTool = createMoaConsultTool(moaManager, config)
  const filesBefore = snapshotFiles(sandbox)
  const toolResult = await moaTool.execute(
    { prompt: "Should we split module X?" },
    { sessionID: "qa-parent", messageID: "qa-message", agent: "sisyphus", directory: sandbox, worktree: sandbox, abort: new AbortController().signal, metadata() {}, async ask() {} },
  )
  const filesAfter = snapshotFiles(sandbox)
  if (typeof toolResult === "string") throw new Error(`Tool returned an error string: ${toolResult}`)
  const bundle = toolResult.metadata
  const decisionBundleCheck = bundle?.synthesis !== undefined ? validateDecisionBundle(bundle.synthesis) : { valid: false, missing: ["synthesis"], extra: [] }

  const assertions = {
    enabledRegistersTool: Object.keys(enabledRecord).includes("moa_consult"),
    disabledOmitsTool: !Object.keys(disabledRecord).includes("moa_consult"),
    enabledNoManagerOmitsTool: !Object.keys(enabledNoManagerRecord).includes("moa_consult"),
    enabledRegistersCommand: enabledCommands.moa !== undefined,
    commandDispatchesTool: (enabledCommands.moa?.template ?? "").includes("moa_consult"),
    disabledOmitsCommand: disabledCommands.moa === undefined,
    resultIsStructured: typeof toolResult !== "string",
    statusCompleted: bundle?.status === "completed",
    toolsExposedZero: bundle?.execution.toolsExposed === 0,
    mutationsZero: bundle?.execution.mutationsPerformed === 0,
    policyConsultationOnly: bundle?.execution.policy === "consultation_only",
    implementationAuthorityParent: bundle?.execution.implementationAuthority === "parent",
    presetResolvedToDefault: bundle?.preset === "qa",
    decisionBundleValid: decisionBundleCheck.valid,
    twoAdvisorsOneAggregator:
      adapter.launches.filter((launch) => launch.role === "advisor").length === 2 &&
      adapter.launches.filter((launch) => launch.role === "aggregator").length === 1,
    everyLaunchToolPolicyNone: adapter.launches.every((launch) => launch.toolPolicy === "none"),
    everyLaunchInternal: adapter.launches.every((launch) => launch.visibility === "internal"),
    zeroFileWrites: filesBefore.length === 0 && filesAfter.length === 0,
  }
  const failedAssertions = Object.entries(assertions).filter(([, passed]) => !passed).map(([name]) => name)

  process.stdout.write(`${JSON.stringify({
    toolResult: bundle,
    output: typeof toolResult === "string" ? toolResult : toolResult.output,
    assertions,
    failedAssertions,
    enabledToolKeys: Object.keys(enabledRecord),
    disabledToolKeys: Object.keys(disabledRecord),
    enabledNoManagerToolKeys: Object.keys(enabledNoManagerRecord),
    commandEnabled: enabledCommands.moa !== undefined,
    commandDisabled: disabledCommands.moa !== undefined,
    launchRoles: adapter.launches.map((launch) => launch.role),
    decisionBundleCheck,
    sandbox: { path: sandbox, filesBefore, filesAfter },
  }, null, 2)}\n`)

  if (failedAssertions.length > 0) throw new Error(`QA assertions failed: ${failedAssertions.join(", ")}`)
  await moaManager.shutdown()
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

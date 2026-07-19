import type {
  MoAChildHandle,
  MoAChildLaunchInput,
  MoAChildResult,
  MoAChildWaitTimeouts,
  MoAExecutionAdapter,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"
import { assertConsultationOnlyLaunch } from "@oh-my-opencode/moa-core/adapter"
import type { MoAResolvedModel, MoATarget } from "@oh-my-opencode/moa-core"
import type { BackgroundTask, BackgroundTaskOutputResult, LaunchInput } from "../background-agent"
import { log as defaultLog } from "../../shared"
import { MoAChildSessionObserver, type MoASessionObserver } from "./moa-session-observer"

// ponytail: fixed safety ceiling; add per-preset budgets only when distinct workloads require them.
const MOA_RESEARCH_MAX_TOOL_CALLS = 12

export interface MoABackgroundManager {
  launch(input: LaunchInput): Promise<Pick<BackgroundTask, "id" | "sessionId">>
  getTask(taskId: string): Partial<BackgroundTask> & Pick<BackgroundTask, "id" | "status"> | undefined
  getTaskLastActivityAt(taskId: string): number | undefined
  readTaskOutput(taskId: string): Promise<BackgroundTaskOutputResult>
  cancelTask(
    taskId: string,
    options?: { source?: string; reason?: string; abortSession?: boolean; skipNotification?: boolean },
  ): Promise<boolean>
}

export interface MoAAdapterParentContext {
  readonly sessionID: string
  readonly messageID: string
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
}

export class MoAChildTaskError extends Error {
  constructor(readonly taskId: string, message: string) {
    super(message)
    this.name = "MoAChildTaskError"
  }
}

function runtimeFallbackChain(
  target: ResolvedMoATarget,
  slotTemperature: number | undefined,
): LaunchInput["fallbackChain"] {
  return target.fallbackChain.map((fallback) => {
    const temperature = slotTemperature ?? fallback.temperature
    return {
      providers: [fallback.providerID],
      model: fallback.modelID,
      ...(fallback.variant !== undefined ? { variant: fallback.variant } : {}),
      ...(fallback.reasoningEffort !== undefined ? { reasoningEffort: fallback.reasoningEffort } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    }
  })
}

function finalModel(
  task: ReturnType<MoABackgroundManager["getTask"]>,
  resolvedTarget: ResolvedMoATarget | undefined,
  taskId: string,
): MoAResolvedModel {
  const attempts = task?.attempts ?? []
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index]
    if (attempt?.providerId !== undefined && attempt.modelId !== undefined) {
      return {
        providerID: attempt.providerId,
        modelID: attempt.modelId,
        ...(attempt.variant !== undefined ? { variant: attempt.variant } : {}),
      }
    }
  }
  if (task?.model !== undefined) return task.model
  if (resolvedTarget !== undefined) return resolvedTarget.model
  throw new MoAChildTaskError(taskId, `MoA child ${taskId} has no resolved model`)
}

type ChildResultInput = {
  readonly handle: MoAChildHandle
  readonly status: MoAChildResult["status"]
  readonly task: ReturnType<MoABackgroundManager["getTask"]>
  readonly resolvedTarget: ResolvedMoATarget | undefined
  readonly output?: string
  readonly errorCategory?: string
}

function childResult(input: ChildResultInput): MoAChildResult {
  return {
    handle: input.handle,
    status: input.status,
    ...(input.output !== undefined ? { output: input.output } : {}),
    finalModel: finalModel(input.task, input.resolvedTarget, input.handle.taskId),
    fallbackCount: input.task?.attemptCount ?? Math.max(0, (input.task?.attempts?.length ?? 1) - 1),
    ...(input.errorCategory !== undefined
      ? { errorCategory: input.errorCategory }
      : input.task?.error !== undefined ? { errorCategory: input.task.error } : {}),
  }
}

function terminalStatus(task: ReturnType<MoABackgroundManager["getTask"]>): MoAChildResult["status"] | undefined {
  switch (task?.status) {
    case "completed":
      return "completed"
    case "error":
    case "interrupt":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "pending":
    case "running":
    case undefined:
      return undefined
  }
}

function waitForTask(
  manager: MoABackgroundManager,
  handle: MoAChildHandle,
  resolvedTarget: ResolvedMoATarget | undefined,
  timeouts: MoAChildWaitTimeouts,
  signal: AbortSignal,
  pollIntervalMs: number,
): Promise<MoAChildResult> {
  const startedAt = Date.now()
  const hardDeadline = startedAt + timeouts.maxWallMs
  let deadline = Math.min(startedAt + timeouts.baseMs, hardDeadline)
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let resolvingOutput = false
    const finish = (result: MoAChildResult): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener("abort", check)
      resolve(result)
    }
    const resolveCompletedOutput = async (
      task: ReturnType<MoABackgroundManager["getTask"]>,
    ): Promise<void> => {
      let output: BackgroundTaskOutputResult
      try {
        output = await manager.readTaskOutput(handle.taskId)
      } catch {
        finish(childResult({
          handle,
          status: "failed",
          task,
          resolvedTarget,
          errorCategory: "output_resolution_failed",
        }))
        return
      }
      if (output.status === "failed") {
        finish(childResult({
          handle,
          status: "failed",
          task,
          resolvedTarget,
          errorCategory: "output_resolution_failed",
        }))
        return
      }
      finish(childResult({ handle, status: "completed", task, resolvedTarget, output: output.output }))
    }
    const check = (): void => {
      const task = manager.getTask(handle.taskId)
      if (signal.aborted) {
        finish(childResult({ handle, status: "cancelled", task, resolvedTarget }))
        return
      }
      const status = terminalStatus(task)
      if (status !== undefined) {
        if (status === "completed") {
          if (!resolvingOutput) {
            resolvingOutput = true
            void resolveCompletedOutput(task)
          }
          return
        }
        finish(childResult({ handle, status, task, resolvedTarget }))
        return
      }
      const now = Date.now()
      if (now >= hardDeadline) {
        finish(childResult({ handle, status: "timed_out", task, resolvedTarget }))
        return
      }
      if (now >= deadline) {
        const lastActivityAt = manager.getTaskLastActivityAt(handle.taskId)
        if (lastActivityAt === undefined || now - lastActivityAt >= timeouts.idleWindowMs) {
          finish(childResult({ handle, status: "timed_out", task, resolvedTarget }))
          return
        }
        deadline = Math.min(deadline + timeouts.idleWindowMs, hardDeadline)
      }
      const remaining = Math.min(deadline, hardDeadline) - now
      timer = setTimeout(check, Math.min(pollIntervalMs, remaining))
    }
    signal.addEventListener("abort", check, { once: true })
    check()
  })
}

export function createMoAExecutionAdapter(options: {
  readonly backgroundManager: MoABackgroundManager
  readonly parent: MoAAdapterParentContext
  readonly resolveTarget: (target: MoATarget) => Promise<ResolvedMoATarget>
  readonly pollIntervalMs?: number
  readonly sessionObserver?: MoASessionObserver
  readonly log?: typeof defaultLog
}): MoAExecutionAdapter {
  const resolvedTargets = new Map<string, ResolvedMoATarget>()
  const observers = new Map<string, MoAChildSessionObserver>()
  const pollIntervalMs = options.pollIntervalMs ?? 50
  const log = options.log ?? defaultLog
  const disposeObserver = async (taskId: string): Promise<void> => {
    const observer = observers.get(taskId)
    if (observer === undefined) return
    observers.delete(taskId)
    await observer.dispose()
  }
  return {
    resolveTarget: options.resolveTarget,
    launchChild: async (input: MoAChildLaunchInput): Promise<MoAChildHandle> => {
      assertConsultationOnlyLaunch(input)
      const isResearchAdvisor = input.role === "advisor" && input.toolPolicy === "read_only"
      const temperature = input.temperature ?? input.target.model.temperature
      const description = `MoA ${input.role}: ${input.orchestration.slot ?? "synthesis"}`
      const observer = options.sessionObserver === undefined
        ? undefined
        : new MoAChildSessionObserver(options.sessionObserver, description, log)
      let task: Pick<BackgroundTask, "id" | "sessionId">
      try {
        task = await options.backgroundManager.launch({
          description,
          prompt: input.prompt,
          agent: input.target.agent,
          parentSessionId: options.parent.sessionID,
          parentMessageId: options.parent.messageID,
          parentAgent: options.parent.agent,
          parentModel: options.parent.model,
          model: {
            ...input.target.model,
            ...(temperature !== undefined ? { temperature } : {}),
            ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
          },
          fallbackChain: runtimeFallbackChain(input.target, input.temperature),
          category: input.target.category,
          visibility: "internal",
          notificationPolicy: "manual",
          // Suppress the regular INTERACTIVE subagent pane. Observe-only MoA
          // projection is an independent capability installed by this callback.
          suppressTmuxSpawn: true,
          toolPolicy: isResearchAdvisor ? "default" : "none",
          capabilityProfile: input.capabilityProfile,
          ...(isResearchAdvisor && input.target.researchToolWhitelist !== undefined
            ? { researchToolWhitelist: input.target.researchToolWhitelist }
            : {}),
          ...(isResearchAdvisor ? { maxToolCalls: MOA_RESEARCH_MAX_TOOL_CALLS } : {}),
          continuationPolicy: "forbid",
          orchestration: input.orchestration,
          ...(observer !== undefined
            ? { onSessionCreated: (sessionId: string): void => { void observer.onSessionCreated(sessionId) } }
            : {}),
        })
      } catch (error) {
        await observer?.dispose()
        throw error
      }
      if (observer !== undefined) observers.set(task.id, observer)
      resolvedTargets.set(task.id, input.target)
      return {
        taskId: task.id,
        ...(task.sessionId !== undefined ? { sessionId: task.sessionId } : {}),
        role: input.role,
        ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}),
      }
    },
    waitForChild: async (handle, timeouts, signal): Promise<MoAChildResult> => {
      try {
        return await waitForTask(
          options.backgroundManager,
          handle,
          resolvedTargets.get(handle.taskId),
          timeouts,
          signal,
          pollIntervalMs,
        )
      } finally {
        await disposeObserver(handle.taskId)
      }
    },
    cancelChild: async (handle, reason): Promise<void> => {
      try {
        await options.backgroundManager.cancelTask(handle.taskId, {
          source: "moa",
          reason,
          skipNotification: true,
        })
      } finally {
        await disposeObserver(handle.taskId)
      }
    },
  }
}

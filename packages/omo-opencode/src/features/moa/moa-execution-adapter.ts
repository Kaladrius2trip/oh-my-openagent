import type {
  MoAChildHandle,
  MoAChildLaunchInput,
  MoAChildResult,
  MoAExecutionAdapter,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"
import { assertConsultationOnlyLaunch } from "@oh-my-opencode/moa-core/adapter"
import type { MoAResolvedModel, MoATarget } from "@oh-my-opencode/moa-core"
import type { BackgroundTask, LaunchInput } from "../background-agent"

export interface MoABackgroundManager {
  launch(input: LaunchInput): Promise<Pick<BackgroundTask, "id" | "sessionId">>
  getTask(taskId: string): Partial<BackgroundTask> & Pick<BackgroundTask, "id" | "status"> | undefined
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

function childResult(
  handle: MoAChildHandle,
  status: MoAChildResult["status"],
  task: ReturnType<MoABackgroundManager["getTask"]>,
  resolvedTarget: ResolvedMoATarget | undefined,
): MoAChildResult {
  return {
    handle,
    status,
    ...(task?.result !== undefined ? { output: task.result } : {}),
    finalModel: finalModel(task, resolvedTarget, handle.taskId),
    fallbackCount: task?.attemptCount ?? Math.max(0, (task?.attempts?.length ?? 1) - 1),
    ...(task?.error !== undefined ? { errorCategory: task.error } : {}),
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
  timeoutMs: number,
  signal: AbortSignal,
  pollIntervalMs: number,
): Promise<MoAChildResult> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: MoAChildResult): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener("abort", check)
      resolve(result)
    }
    const check = (): void => {
      const task = manager.getTask(handle.taskId)
      if (signal.aborted) {
        finish(childResult(handle, "cancelled", task, resolvedTarget))
        return
      }
      const status = terminalStatus(task)
      if (status !== undefined) {
        finish(childResult(handle, status, task, resolvedTarget))
        return
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        finish(childResult(handle, "timed_out", task, resolvedTarget))
        return
      }
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
}): MoAExecutionAdapter {
  const resolvedTargets = new Map<string, ResolvedMoATarget>()
  const pollIntervalMs = options.pollIntervalMs ?? 50
  return {
    resolveTarget: options.resolveTarget,
    launchChild: async (input: MoAChildLaunchInput): Promise<MoAChildHandle> => {
      assertConsultationOnlyLaunch(input)
      const temperature = input.temperature ?? input.target.model.temperature
      const task = await options.backgroundManager.launch({
        description: `MoA ${input.role}: ${input.orchestration.slot ?? "synthesis"}`,
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
        suppressTmuxSpawn: true,
        toolPolicy: "none",
        capabilityProfile: "moa-consultation-only",
        continuationPolicy: "forbid",
        orchestration: input.orchestration,
      })
      resolvedTargets.set(task.id, input.target)
      return {
        taskId: task.id,
        ...(task.sessionId !== undefined ? { sessionId: task.sessionId } : {}),
        role: input.role,
        ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}),
      }
    },
    waitForChild: async (handle, timeoutMs, signal): Promise<MoAChildResult> => {
      return waitForTask(
        options.backgroundManager,
        handle,
        resolvedTargets.get(handle.taskId),
        timeoutMs,
        signal,
        pollIntervalMs,
      )
    },
    cancelChild: async (handle, reason): Promise<void> => {
      await options.backgroundManager.cancelTask(handle.taskId, {
        source: "moa",
        reason,
        skipNotification: true,
      })
    },
  }
}

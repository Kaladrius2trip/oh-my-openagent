import type { BackgroundTask, LaunchInput } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { isProviderExhaustionFallbackEligible } from "@oh-my-opencode/model-core"
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared"
import {
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
} from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { resolveDispatchClient } from "../../shared/live-server-route"
import { isRecord } from "../../shared/record-type-guard"
import { abortWithTimeout } from "./abort-with-timeout"
import { ensureCurrentAttempt, scheduleRetryAttempt } from "./attempt-lifecycle"

export class TeamModeFallbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeamModeFallbackError"
  }
}

export class FallbackRetryBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FallbackRetryBlockedError"
  }
}

function canonicalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

export type FallbackRetryHandlerDeps = {
  log: typeof log
  readProviderModelsCache: typeof readProviderModelsCache
  readConnectedProvidersCache: typeof readConnectedProvidersCache
  shouldRetryError: typeof shouldRetryError
  getNextFallback: typeof getNextFallback
  hasMoreFallbacks: typeof hasMoreFallbacks
  selectFallbackProvider: typeof selectFallbackProvider
  transformModelForProvider: typeof transformModelForProvider
  isProviderExhaustionFallbackEligible: (error: unknown) => boolean
  abortAndConfirmStopped: (client: OpencodeClient, sessionID: string) => Promise<boolean>
}

const defaultFallbackRetryHandlerDeps: FallbackRetryHandlerDeps = {
  log,
  readProviderModelsCache,
  readConnectedProvidersCache,
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
  transformModelForProvider,
  isProviderExhaustionFallbackEligible,
  abortAndConfirmStopped,
}

const fallbackRetryInFlight = new Map<string, Promise<boolean>>()

export async function abortAndConfirmStopped(
  client: OpencodeClient,
  sessionID: string,
  abortTimeoutMs = 10_000,
): Promise<boolean> {
  try {
    const resolved = await resolveDispatchClient(client, sessionID)
    const routedClient = resolved.client as OpencodeClient
    if (!await abortWithTimeout(routedClient, sessionID, abortTimeoutMs)) return false
    if (typeof routedClient.session?.status !== "function") return false

    const response = await routedClient.session.status()
    if (!isRecord(response) || !isRecord(response.data) || Array.isArray(response.data)) {
      return false
    }
    const sessionStatus = response.data[sessionID]
    if (sessionStatus === undefined) return true
    return isRecord(sessionStatus)
      && !Array.isArray(sessionStatus)
      && sessionStatus.type === "idle"
  } catch {
    return false
  }
}

function runFallbackRetryOnce(
  taskId: string,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  const existing = fallbackRetryInFlight.get(taskId)
  if (existing !== undefined) return existing

  const pending = operation()
  fallbackRetryInFlight.set(taskId, pending)
  void pending.then(
    () => {
      if (fallbackRetryInFlight.get(taskId) === pending) fallbackRetryInFlight.delete(taskId)
    },
    () => {
      if (fallbackRetryInFlight.get(taskId) === pending) fallbackRetryInFlight.delete(taskId)
    },
  )
  return pending
}

export function buildRetryLaunchInput(
  task: BackgroundTask,
  nextModel: NonNullable<LaunchInput["model"]>,
): LaunchInput {
  return {
    description: task.description,
    directory: task.directory,
    prompt: task.prompt,
    agent: task.agent,
    parentSessionId: task.parentSessionId,
    parentMessageId: task.parentMessageId,
    parentModel: task.parentModel,
    parentAgent: task.parentAgent,
    parentTools: task.parentTools,
    teamRunId: task.teamRunId,
    suppressTmuxSpawn: task.suppressTmuxSpawn,
    model: nextModel,
    fallbackChain: task.fallbackChain,
    isUnstableAgent: task.isUnstableAgent,
    skills: task.skills,
    skillContent: task.skillContent,
    category: task.category,
    sessionPermission: task.sessionPermission,
    onSessionCreated: task.onSessionCreated,
    userPermission: task.userPermission,
    visibility: task.visibility,
    notificationPolicy: task.notificationPolicy,
    continuationPolicy: task.continuationPolicy,
    toolPolicy: task.toolPolicy,
    capabilityProfile: task.capabilityProfile,
    researchToolWhitelist: task.researchToolWhitelist,
    maxToolCalls: task.maxToolCalls,
    orchestration: task.orchestration,
  }
}

export async function tryFallbackRetry(args: {
  task: BackgroundTask
  errorInfo: { name?: string; message?: string; statusCode?: number }
  source: string
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, QueueItem[]>
  processKey: (key: string) => void
  onRetrying?: (details: {
    task: BackgroundTask
    source: string
    previousSessionID?: string
    failedModel?: string
    failedError?: string
    nextModel: string
  }) => void
  deps?: Partial<FallbackRetryHandlerDeps>
}): Promise<boolean> {
  const { task, errorInfo, source, concurrencyManager, client, idleDeferralTimers, queuesByKey, processKey, onRetrying } = args
  const deps = { ...defaultFallbackRetryHandlerDeps, ...args.deps }
  const fallbackChain = task.fallbackChain
  const canUseProviderExhaustionFallback = deps.isProviderExhaustionFallbackEligible(errorInfo)
  const canRetry =
    (deps.shouldRetryError(errorInfo) || canUseProviderExhaustionFallback) &&
    fallbackChain &&
    fallbackChain.length > 0 &&
    deps.hasMoreFallbacks(fallbackChain, task.attemptCount ?? 0)

  if (!canRetry) return false

  const attemptCount = task.attemptCount ?? 0
  const providerModelsCache = deps.readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? deps.readConnectedProvidersCache()
  const connectedSet = connectedProviders ? new Set(connectedProviders.map(p => p.toLowerCase())) : null

  const isReachable = (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true
    return entry.providers.some((provider) => connectedSet.has(provider.toLowerCase()))
  }

  let selectedAttemptCount = attemptCount
  let nextFallback: FallbackEntry | undefined
  let nextProviderID: string | undefined
  while (fallbackChain && selectedAttemptCount < fallbackChain.length) {
    const candidate = deps.getNextFallback(fallbackChain, selectedAttemptCount)
    if (!candidate) break
    selectedAttemptCount++
    if (!isReachable(candidate)) {
      deps.log("[background-agent] Skipping unreachable fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    const candidateProviderID = deps.selectFallbackProvider(
      candidate.providers,
      task.model?.providerID,
    )
    const candidateModelID = deps.transformModelForProvider(candidateProviderID, candidate.model)
    const isNoOpFallback =
      !!task.model &&
      candidateProviderID.toLowerCase() === task.model.providerID.toLowerCase() &&
      canonicalizeModelID(candidateModelID) === canonicalizeModelID(task.model.modelID)
    if (isNoOpFallback) {
      deps.log("[background-agent] Skipping no-op fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    nextFallback = candidate
    nextProviderID = candidateProviderID
    break
  }
  if (!nextFallback) return false

  const providerID = nextProviderID ?? deps.selectFallbackProvider(
    nextFallback.providers,
    task.model?.providerID,
  )

  deps.log("[background-agent] Retryable error, attempting fallback:", {
    taskId: task.id,
    source,
    errorName: errorInfo.name,
    errorMessage: errorInfo.message?.slice(0, 100),
    attemptCount: selectedAttemptCount,
    nextModel: `${providerID}/${nextFallback.model}`,
  })

  const previousSessionID = task.sessionId
  const previousModel = task.model
  const previousConcurrencyKey = task.concurrencyKey

  const transformedModelId = deps.transformModelForProvider(providerID, nextFallback.model)
  const nextModel = {
    providerID,
    modelID: transformedModelId,
    variant: nextFallback.variant,
    ...(nextFallback.reasoningEffort !== undefined ? { reasoningEffort: nextFallback.reasoningEffort } : {}),
    ...(nextFallback.temperature !== undefined ? { temperature: nextFallback.temperature } : {}),
    ...(nextFallback.top_p !== undefined ? { top_p: nextFallback.top_p } : {}),
    ...(nextFallback.maxTokens !== undefined ? { maxTokens: nextFallback.maxTokens } : {}),
    ...(nextFallback.thinking !== undefined ? { thinking: nextFallback.thinking } : {}),
  }

  // Guard: a team-mode task (teamRunId set) MUST carry an onSessionCreated callback so
  // the fallback session gets registered in the team-session registry under the original
  // member slot. Without it the new session would not appear as a team participant and
  // every subsequent team tool call would throw "not in team". Fail with a bounded
  // structured error instead of silently entering that confusing runtime state.
  if (task.teamRunId && !task.onSessionCreated) {
    deps.log("[background-agent] team-mode fallback denied: task has teamRunId but no onSessionCreated; cannot preserve team membership", {
      taskId: task.id,
      teamRunId: task.teamRunId,
    })
    throw new TeamModeFallbackError(
      `team-mode fallback denied: cannot preserve team context for task ${task.id} (teamRunId=${task.teamRunId})`,
    )
  }

  const rawKey = `${nextModel.providerID}/${nextModel.modelID}`
  const key = concurrencyManager.getConcurrencyKey(rawKey)
  const queue = queuesByKey.get(key) ?? []
  const retryInput = buildRetryLaunchInput(task, nextModel)

  return runFallbackRetryOnce(task.id, async () => {
    if (previousSessionID) {
      const stopped = await deps.abortAndConfirmStopped(client, previousSessionID)
      if (!stopped) {
        throw new FallbackRetryBlockedError(
          `Fallback retry blocked: session ${previousSessionID} termination was not confirmed`,
        )
      }
    }

    task.attemptCount = selectedAttemptCount
    const failedAttemptID = ensureCurrentAttempt(task, previousModel).attemptId
    const nextAttempt = scheduleRetryAttempt(task, failedAttemptID, nextModel, errorInfo.message)
    if (!nextAttempt) return false

    task.queuedAt = new Date()
    task.retryNotification = {
      previousSessionID,
      failedModel: previousModel ? `${previousModel.providerID}/${previousModel.modelID}` : undefined,
      failedError: errorInfo.message,
      nextModel: `${providerID}/${transformedModelId}`,
    }

    const idleTimer = idleDeferralTimers.get(task.id)
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleDeferralTimers.delete(task.id)
    }

    if (previousConcurrencyKey) {
      concurrencyManager.release(previousConcurrencyKey)
      task.concurrencyKey = undefined
    }

    try {
      onRetrying?.({
        task,
        source,
        previousSessionID,
        failedModel: task.retryNotification.failedModel,
        failedError: errorInfo.message,
        nextModel: `${providerID}/${transformedModelId}`,
      })
    } catch (error) {
      deps.log("[background-agent] Failed to publish fallback retry notification:", {
        taskId: task.id,
        error,
      })
    }

    queue.push({ task, input: retryInput, attemptID: nextAttempt.attemptId, rawConcurrencyKey: rawKey })
    queuesByKey.set(key, queue)
    processKey(key)
    return true
  })
}

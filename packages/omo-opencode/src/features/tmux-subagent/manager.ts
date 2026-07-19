// allow: SIZE_OK - legacy tmux lifecycle orchestrator; PR16 changes only pane ownership seams.
import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession, CapacityConfig, PaneAction, TmuxPaneMode, WindowState, WindowStateQueryResult } from "./types"
import * as sharedModule from "../../shared"
import { resolveSessionEventID } from "../../shared/event-session-id"
import {
  isInsideTmux as defaultIsInsideTmux,
  getCurrentPaneId as defaultGetCurrentPaneId,
  POLL_INTERVAL_BACKGROUND_MS,
  spawnTmuxWindow,
  spawnTmuxSession,
  killTmuxSessionIfExists,
  getIsolatedSessionName,
  sweepStaleOmoAgentSessions,
  sweepStaleOmoAttachPanes,
  activateReadOnlyTmuxPane,
  activateTmuxPane,
  classifyTmuxError,
} from "../../shared/tmux"
import { queryWindowState as defaultQueryWindowState } from "./pane-state-querier"
import { decideSpawnActions, decideCloseAction, type SessionMapping } from "./decision-engine"
import { executeActions, executeAction, type ExecuteActionsResult, type ExecuteContext } from "./action-executor"
import { TmuxPollingManager } from "./polling-manager"
import {
  createTrackedSession,
  markTrackedSessionActivated,
  markTrackedSessionClosePending,
} from "./tracked-session-state"
import { waitForSessionReady } from "./session-ready-waiter"
import { isAttachableSessionStatus } from "./attachable-session-status"
import { parseSessionStatusResponse } from "./session-status-parser"
import { FailedReadinessCache, type FailedReadinessSessionSeed } from "./failed-readiness-cache"
import { resolveServerUrl } from "./resolve-server-url"
import { sweepStaleTmuxResources } from "./stale-tmux-resource-sweeper"
import { createSourcePaneRecovery, type SourcePaneRecovery } from "./source-pane-recovery"
import {
  createDeferredAttachLoop,
  type DeferredAttachLoop,
  type DeferredDrainOutcome,
} from "./deferred-attach-loop"
import {
  createSessionPaneDeduplicator,
  type SessionPaneDeduplicator,
} from "./session-pane-deduplicator"
type OpencodeClient = PluginInput["client"]

type SpawnStage =
  | "deferred.attach"
  | "deferred.isolated-container"
  | "session.created"
  | "session.observe"
  | "session.idle.retry"

interface SessionCreatedEvent {
  type: string
  properties?: { info?: { id?: string; parentID?: string; title?: string } }
}

interface DeferredSession {
  sessionId: string
  title: string
  queuedAt: Date
  retryIsolatedContainer: boolean
  mode: TmuxPaneMode
}

type IsolatedContainerSpawnOutcome =
  | { readonly kind: "spawned"; readonly paneId: string }
  | { readonly kind: "existing" }
  | { readonly kind: "none" }

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
  queryWindowState: (paneId: string) => Promise<WindowStateQueryResult>
  waitForSessionReady: (params: { client: OpencodeClient; sessionId: string }) => Promise<boolean>
  executeActions: typeof executeActions
  executeAction: typeof executeAction
  activateTmuxPane: typeof activateTmuxPane
  activateReadOnlyTmuxPane: typeof activateReadOnlyTmuxPane
  sessionPaneDeduplicator: SessionPaneDeduplicator
  log: typeof sharedModule.log
}

/**
 * Options passed to TmuxSessionManager at construction time.
 *
 * Distinct from `TmuxUtilDeps` (low-level tmux util injection): these are
 * external policy hooks the manager defers to without owning the policy.
 */
export interface TmuxSessionManagerOptions {
  /**
   * Predicate the manager calls in `onSessionCreated` to decide whether this
   * session should be ignored entirely. Used to keep team-mode member sessions
   * out of the subagent pane tracking, since team-layout-tmux owns their pane
   * lifecycle separately and double-tracking causes pane double-close races
   * and stale entries in the subagent panel.
   *
   * Defaults to `() => false` (track everything).
   */
  shouldSkipSession?: (sessionId: string) => boolean
}

const defaultTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: defaultIsInsideTmux,
  getCurrentPaneId: defaultGetCurrentPaneId,
  queryWindowState: defaultQueryWindowState,
  waitForSessionReady,
  executeActions,
  executeAction,
  activateTmuxPane,
  activateReadOnlyTmuxPane,
  sessionPaneDeduplicator: createSessionPaneDeduplicator(),
  log: sharedModule.log,
}

const DEFERRED_SESSION_TTL_MS = 5 * 60 * 1000
const FAILED_READINESS_SESSION_TTL_MS = 5 * 60 * 1000
const MAX_DEFERRED_QUEUE_SIZE = 20
const MAX_CLOSE_RETRY_COUNT = 3
// After MAX_CLOSE_RETRY_COUNT failed close attempts with the pane still
// visible, finalizeForceRemoveCandidate stamps a cooldown on the tracked
// session. retryPendingCloses checks the stamp on subsequent passes:
// once elapsed, the retry counter and closePending reset so polling /
// retry can attempt the close again. Without this, a wedged pane stays
// in `this.sessions` for the rest of the parent session's lifetime.
const CLOSE_RETRY_COOLDOWN_MS = 15 * 60 * 1000
const MAX_ISOLATED_CONTAINER_NULL_STATE_COUNT = 2
let nextIsolatedSessionManagerId = 1

function createIsolatedSessionManagerId(): string {
  const managerId = String(nextIsolatedSessionManagerId)
  nextIsolatedSessionManagerId += 1
  return managerId
}

function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${String(value)}`)
}

export class TmuxSessionManager {
  private client: OpencodeClient
  private tmuxConfig: TmuxConfig
  private projectDirectory: string
  private serverUrl: string
  private ctxServerUrl: string | undefined
  private readonly sourcePaneRecovery: SourcePaneRecovery
  private sessions = new Map<string, TrackedSession>()
  private pendingSessions = new Set<string>()
  private closedByPolling = new Set<string>()
  private readonly failedReadinessCache: FailedReadinessCache
  private spawnQueue: Promise<void> = Promise.resolve()
  private deferredSessions = new Map<string, DeferredSession>()
  private deferredQueue: string[] = []
  private readonly deferredAttachLoop: DeferredAttachLoop
  private pendingDeferredOverflowWarnings = 0
  private deps: TmuxUtilDeps
  private readonly sessionPaneDeduplicator: SessionPaneDeduplicator
  private shouldSkipSession: (sessionId: string) => boolean
  private pollingManager: TmuxPollingManager
  private isolatedContainerPaneId: string | undefined
  private isolatedWindowPaneId: string | undefined
  private isolatedContainerNullStateCount = 0
  private staleSweepCompleted = false
  private staleSweepInProgress = false
  private isolatedSessionManagerId = createIsolatedSessionManagerId()
  constructor(
    ctx: PluginInput,
    tmuxConfig: TmuxConfig,
    deps: Partial<TmuxUtilDeps> = {},
    options: TmuxSessionManagerOptions = {},
  ) {
    this.client = ctx.client
    this.tmuxConfig = tmuxConfig
    this.projectDirectory = ctx.directory || process.cwd()
    this.deps = { ...defaultTmuxDeps, ...deps }
    this.sessionPaneDeduplicator = this.deps.sessionPaneDeduplicator
    this.shouldSkipSession = options.shouldSkipSession ?? (() => false)
    this.failedReadinessCache = new FailedReadinessCache({
      ttlMs: FAILED_READINESS_SESSION_TTL_MS,
    })
    const rawServerUrl = ctx.serverUrl?.toString()
    this.ctxServerUrl = rawServerUrl
    this.serverUrl = resolveServerUrl(rawServerUrl, process.env, this.deps.log)
    const initialSourcePaneId = this.deps.getCurrentPaneId()
    this.sourcePaneRecovery = createSourcePaneRecovery({
      initialPaneId: initialSourcePaneId,
      queryWindowState: this.deps.queryWindowState,
      getManagedPaneIds: () => new Set(Array.from(this.sessions.values(), (session) => session.paneId)),
      log: this.deps.log,
    })
    this.deferredAttachLoop = createDeferredAttachLoop({
      normalIntervalMs: POLL_INTERVAL_BACKGROUND_MS,
      hasWork: () => this.deferredQueue.length > 0 || this.failedReadinessCache.size > 0,
      drain: this.runDeferredAttachTick.bind(this),
      schedule: (run, delayMs) => setTimeout(run, delayMs),
      cancel: (timer) => clearTimeout(timer),
      onError: (error) => this.deps.log("[tmux-session-manager] deferred attach drain failed", { error: String(error) }),
    })
    this.pollingManager = new TmuxPollingManager(
      this.client,
      this.sessions,
      this.closeSessionFromPolling.bind(this),
      this.retryPendingCloses.bind(this),
      this.queryWindowStateSafely.bind(this),
      this.activateTrackedSessionPane.bind(this),
      this.canAutoActivatePane.bind(this),
    )
    this.deps.log("[tmux-session-manager] initialized", {
      configEnabled: this.tmuxConfig.enabled,
      tmuxConfig: this.tmuxConfig,
      projectDirectory: this.projectDirectory,
      serverUrl: this.serverUrl,
      sourcePaneId: initialSourcePaneId,
    })
  }
  private isEnabled(): boolean {
    return this.tmuxConfig.enabled && this.deps.isInsideTmux()
  }

  private isIsolated(): boolean {
    return this.tmuxConfig.isolation === "window" || this.tmuxConfig.isolation === "session"
  }

  private getEffectiveSourcePaneId(): string | undefined {
    if (this.isIsolated() && this.isolatedWindowPaneId) {
      return this.isolatedWindowPaneId
    }
    return this.sourcePaneRecovery.getPaneId()
  }

  private async queryEffectiveWindowState(): Promise<WindowStateQueryResult> {
    if (this.isIsolated() && this.isolatedWindowPaneId) {
      return this.deps.queryWindowState(this.isolatedWindowPaneId)
    }
    return this.sourcePaneRecovery.queryWindowState()
  }

  private async spawnInIsolatedContainer(
    sessionId: string,
    title: string,
  ): Promise<IsolatedContainerSpawnOutcome> {
    if (!this.isIsolated()) return { kind: "none" }
    if (this.isolatedWindowPaneId) {
        const stateResult = await this.deps.queryWindowState(this.isolatedWindowPaneId).catch((error): WindowStateQueryResult => {
        this.deps.log("[tmux-session-manager] failed to query isolated window state", {
          paneId: this.isolatedWindowPaneId,
          error: String(error),
        })
        return { kind: "transient", detail: String(error) }
      })
      if (stateResult.kind === "ok") {
        this.isolatedContainerNullStateCount = 0
        return { kind: "none" }
      }
      this.isolatedContainerNullStateCount += 1
      this.deps.log("[tmux-session-manager] isolated container state query returned null", {
        paneId: this.isolatedWindowPaneId,
        nullStateCount: this.isolatedContainerNullStateCount,
        maxNullStateCount: MAX_ISOLATED_CONTAINER_NULL_STATE_COUNT,
      })
      if (this.isolatedContainerNullStateCount < MAX_ISOLATED_CONTAINER_NULL_STATE_COUNT) {
        return { kind: "none" }
      }
      this.isolatedContainerPaneId = undefined
      this.isolatedWindowPaneId = undefined
      this.isolatedContainerNullStateCount = 0
    }

    const isolation = this.tmuxConfig.isolation
    this.deps.log("[tmux-session-manager] creating isolated tmux container", { isolation, sessionId, title })

    const spawnOutcome = await this.sessionPaneDeduplicator.run(
      sessionId,
      () => isolation === "session"
        ? spawnTmuxSession(
          sessionId,
          title,
          this.tmuxConfig,
          this.serverUrl,
          this.projectDirectory,
          this.sourcePaneRecovery.getPaneId(),
          undefined,
          this.isolatedSessionManagerId,
        )
        : spawnTmuxWindow(sessionId, title, this.tmuxConfig, this.serverUrl, this.projectDirectory),
      (result) => result.paneId,
    )
    let result: Awaited<ReturnType<typeof spawnTmuxWindow>>
    switch (spawnOutcome.kind) {
      case "existing":
        this.deps.log("[tmux-session-manager] isolated pane spawn skipped because session already has a tmux pane", {
          sessionId,
          paneId: spawnOutcome.paneId,
        })
        return { kind: "existing" }
      case "discarded":
        return { kind: "none" }
      case "spawned":
        result = spawnOutcome.result
        break
      default:
        return assertNever(spawnOutcome)
    }

    if (result.success && result.paneId) {
      this.isolatedContainerPaneId = result.paneId
      this.isolatedWindowPaneId = result.paneId
      this.isolatedContainerNullStateCount = 0
      this.deps.log("[tmux-session-manager] isolated container created", {
        isolation,
        paneId: result.paneId,
      })
      return { kind: "spawned", paneId: result.paneId }
    }
    this.deps.log("[tmux-session-manager] failed to create isolated container", { isolation, sessionId })
    return { kind: "none" }
  }

  private getCapacityConfig(): CapacityConfig {
    return {
      layout: this.tmuxConfig.layout,
      mainPaneSize: this.tmuxConfig.main_pane_size,
      mainPaneMinWidth: this.tmuxConfig.main_pane_min_width,
      agentPaneWidth: this.tmuxConfig.agent_pane_min_width,
    }
  }

  private getSessionMappings(): SessionMapping[] {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      paneId: s.paneId,
      createdAt: s.createdAt,
    }))
  }

  getTrackedPaneId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.paneId
  }

  getServerUrl(): string {
    return this.serverUrl
  }

  getCtxServerUrl(): string | undefined {
    return this.ctxServerUrl
  }

  private removeTrackedSession(sessionId: string): void {
    this.sessions.delete(sessionId)

    if (this.sessions.size === 0) {
      this.pollingManager.stopPolling()
    }
  }

  private reassignIsolatedContainerAnchor(): void {
    const nextAnchor = this.sessions.values().next().value
    if (!nextAnchor) {
      return
    }

    this.isolatedContainerNullStateCount = 0
    this.isolatedWindowPaneId = nextAnchor.paneId
    this.deps.log("[tmux-session-manager] reassigned isolated container anchor pane", {
      sessionId: nextAnchor.sessionId,
      paneId: nextAnchor.paneId,
    })
  }

  private async cleanupIsolatedContainerAfterSessionDeletion(
    tracked: TrackedSession,
    isolatedPaneAlreadyClosed: boolean,
    state: WindowState,
  ): Promise<void> {
    if (tracked.paneId !== this.isolatedWindowPaneId) {
      return
    }

    if (this.sessions.size > 0) {
      this.reassignIsolatedContainerAnchor()
      return
    }

    const isolatedContainerPaneId = this.isolatedContainerPaneId
    this.isolatedContainerNullStateCount = 0
    this.isolatedContainerPaneId = undefined
    this.isolatedWindowPaneId = undefined

    if (!isolatedContainerPaneId) {
      return
    }

    if (isolatedPaneAlreadyClosed && tracked.paneId === isolatedContainerPaneId) {
      return
    }

    try {
      const result = await this.deps.executeAction(
        { type: "close", paneId: isolatedContainerPaneId, sessionId: tracked.sessionId },
        {
          config: this.tmuxConfig,
          directory: this.projectDirectory,
          serverUrl: this.serverUrl,
          windowState: state,
          sourcePaneId: this.sourcePaneRecovery.getPaneId() ?? tracked.paneId,
        },
      )

      if (!result.success) {
        this.deps.log("[tmux-session-manager] failed to close isolated container pane after anchor session deletion", {
          sessionId: tracked.sessionId,
          paneId: isolatedContainerPaneId,
        })
      }
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to cleanup isolated container pane after anchor session deletion", {
        sessionId: tracked.sessionId,
        paneId: isolatedContainerPaneId,
        error: String(error),
      })
    }
  }

  private markSessionClosePending(sessionId: string): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    this.sessions.set(sessionId, markTrackedSessionClosePending(tracked))
    this.deps.log("[tmux-session-manager] marked session close pending", {
      sessionId,
      paneId: tracked.paneId,
      closeRetryCount: tracked.closeRetryCount,
    })
  }

  private async queryWindowStateSafely(): Promise<WindowState | null> {
    const paneId = this.getEffectiveSourcePaneId()
    if (!paneId) return null

    try {
      const result = await this.queryEffectiveWindowState()
      switch (result.kind) {
        case "ok":
          return result.state
        case "source_gone":
          return null
        case "transient":
          this.deps.log("[tmux-session-manager] transient window state query failure", { detail: result.detail })
          return null
      }
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to query window state for close", {
        error: String(error),
      })
      return null
    }
  }

  private async activateTrackedSessionPane(tracked: TrackedSession): Promise<boolean> {
    if (tracked.mode === "observe-only") {
      return this.deps.activateReadOnlyTmuxPane(
        tracked.paneId,
        tracked.sessionId,
        this.serverUrl,
        this.projectDirectory,
      )
    }
    return this.deps.activateTmuxPane(
      tracked.paneId,
      tracked.sessionId,
      this.serverUrl,
      this.projectDirectory,
    )
  }

  private async addTrackedSession(
    session: FailedReadinessSessionSeed,
    paneId: string,
  ): Promise<TrackedSession> {
    const tracked = createTrackedSession({
      sessionId: session.sessionId,
      paneId,
      description: session.title,
      mode: session.mode,
    })
    this.sessions.set(session.sessionId, tracked)

    if (tracked.mode === "observe-only" && await this.activateTrackedSessionPane(tracked)) {
      markTrackedSessionActivated(tracked)
    }

    this.pollingManager.startPolling()
    return tracked
  }

  private windowStateContainsPane(state: WindowState, paneId: string): boolean {
    return state.mainPane?.paneId === paneId
      || state.agentPanes.some((pane) => pane.paneId === paneId)
  }

  private async finalizeForceRemoveCandidate(
    tracked: TrackedSession,
    source: string,
  ): Promise<boolean> {
    const state = await this.queryWindowStateSafely()
    if (!state) {
      this.deps.log("[tmux-session-manager] unable to verify pane after max close retries; keeping session tracked", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        source,
      })
      return false
    }

    if (this.windowStateContainsPane(state, tracked.paneId)) {
      // The session is kept in `this.sessions` for operator visibility
      // ("manual intervention required" was the maintainer's explicit
      // intent in zombie-pane.test.ts), but before this change there was
      // no way out: polling skipped it via `!closePending`,
      // retryPendingCloses skipped it via `closeRetryCount >= MAX`, so the
      // entry stayed wedged forever and panes accumulated across long
      // parent sessions.
      //
      // Stamp a cooldown timestamp. retryPendingCloses checks it on
      // subsequent passes — once elapsed, the retry counter and
      // `closePending` reset, polling can re-queue the session, and the
      // close path gets another shot. A pane that becomes responsive
      // later eventually cleans up naturally; a permanently wedged pane
      // retries every CLOSE_RETRY_COOLDOWN_MS instead of leaking memory
      // for the rest of the parent session's lifetime.
      this.deps.log("[tmux-session-manager] pane still exists after max close retries; arming retry cooldown for next attempt", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        closeRetryCount: tracked.closeRetryCount,
        cooldownMs: CLOSE_RETRY_COOLDOWN_MS,
        source,
      })
      const currentTracked = this.sessions.get(tracked.sessionId)
      if (currentTracked) {
        currentTracked.closeRetryCooldownUntil = new Date(Date.now() + CLOSE_RETRY_COOLDOWN_MS)
      }
      return false
    }

    this.deps.log("[tmux-session-manager] pane already gone after max close retries; finalizing tracked close", {
      sessionId: tracked.sessionId,
      paneId: tracked.paneId,
      source,
    })
    await this.finalizeTrackedSessionClose({
      tracked,
      state,
      isolatedPaneAlreadyClosed: true,
    })
    return true
  }

  private canAutoActivatePane(state: WindowState): boolean {
    if (!this.isIsolated()) return true
    return state.windowActive === true && state.sessionAttached === true
  }

  private async closeTrackedSessionPane(args: {
    tracked: TrackedSession
    state: WindowState
  }): Promise<boolean> {
    const { tracked, state } = args

    try {
      const result = await this.deps.executeAction(
        { type: "close", paneId: tracked.paneId, sessionId: tracked.sessionId },
        {
          config: this.tmuxConfig,
          directory: this.projectDirectory,
          serverUrl: this.serverUrl,
          windowState: state,
          sourcePaneId: this.getEffectiveSourcePaneId(),
        }
      )

      return result.success
    } catch (error) {
      this.deps.log("[tmux-session-manager] close session pane failed", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        error: String(error),
      })
      return false
    }
  }

  private async finalizeTrackedSessionClose(args: {
    tracked: TrackedSession
    state: WindowState
    isolatedPaneAlreadyClosed: boolean
  }): Promise<void> {
    const { tracked, state, isolatedPaneAlreadyClosed } = args
    this.removeTrackedSession(tracked.sessionId)
    await this.cleanupIsolatedContainerAfterSessionDeletion(
      tracked,
      isolatedPaneAlreadyClosed,
      state,
    )
  }

  private async closeTrackedSession(tracked: TrackedSession): Promise<boolean> {
    const state = await this.queryWindowStateSafely()
    if (!state) return false

    const closed = await this.closeTrackedSessionPane({ tracked, state })
    if (!closed) {
      return false
    }

    await this.finalizeTrackedSessionClose({
      tracked,
      state,
      isolatedPaneAlreadyClosed: true,
    })
    return true
  }

  private async retryPendingCloses(): Promise<void> {
    const pendingSessions = Array.from(this.sessions.values()).filter(
      (tracked) => tracked.closePending,
    )

    for (const tracked of pendingSessions) {
      if (!this.sessions.has(tracked.sessionId)) continue

      if (tracked.closeRetryCount >= MAX_CLOSE_RETRY_COUNT) {
        if (tracked.closeRetryCooldownUntil) {
          if (Date.now() >= tracked.closeRetryCooldownUntil.getTime()) {
            this.deps.log("[tmux-session-manager] close-retry cooldown elapsed; resetting retry state so polling can re-attempt", {
              sessionId: tracked.sessionId,
              paneId: tracked.paneId,
            })
            const fresh = this.sessions.get(tracked.sessionId)
            if (fresh) {
              fresh.closeRetryCount = 0
              fresh.closePending = false
              fresh.closeRetryCooldownUntil = undefined
            }
            continue
          }
          // Cooldown still active — skip and let next pass check again.
          continue
        }
        await this.finalizeForceRemoveCandidate(tracked, "retryPendingCloses.max-retries")
        continue
      }

      const closed = await this.closeTrackedSession(tracked)
      if (closed) {
        this.deps.log("[tmux-session-manager] retried close succeeded", {
          sessionId: tracked.sessionId,
          paneId: tracked.paneId,
          closeRetryCount: tracked.closeRetryCount,
        })
        continue
      }

      const currentTracked = this.sessions.get(tracked.sessionId)
      if (!currentTracked || !currentTracked.closePending) {
        continue
      }

      const nextRetryCount = currentTracked.closeRetryCount + 1
      if (nextRetryCount >= MAX_CLOSE_RETRY_COUNT) {
        // Bump the persisted counter to MAX BEFORE handing off to finalize.
        // Without this, finalize sets the cooldown but the next pass sees
        // counter < MAX and tries close again, re-stamping cooldown in a
        // loop with no progress.
        this.sessions.set(currentTracked.sessionId, {
          ...currentTracked,
          closeRetryCount: nextRetryCount,
        })
        const refreshed = this.sessions.get(currentTracked.sessionId)
        await this.finalizeForceRemoveCandidate(refreshed ?? currentTracked, "retryPendingCloses.failed-retry")
        continue
      }

      this.sessions.set(currentTracked.sessionId, {
        ...currentTracked,
        closePending: true,
        closeRetryCount: nextRetryCount,
      })
      this.deps.log("[tmux-session-manager] retried close failed", {
        sessionId: currentTracked.sessionId,
        paneId: currentTracked.paneId,
        closeRetryCount: nextRetryCount,
      })
    }
  }

  private enqueueDeferredSession(
    sessionId: string,
    title: string,
    mode: TmuxPaneMode,
    retryIsolatedContainer = false,
  ): void {
    if (this.shouldSkipRespawnAfterPollingClose(sessionId, "deferred enqueue")) {
      this.failedReadinessCache.clear(sessionId)
      return
    }

    const existingDeferredSession = this.deferredSessions.get(sessionId)
    if (existingDeferredSession) {
      if (retryIsolatedContainer && !existingDeferredSession.retryIsolatedContainer) {
        this.deferredSessions.set(sessionId, {
          ...existingDeferredSession,
          retryIsolatedContainer: true,
        })
      }
      return
    }
    if (this.deferredQueue.length >= MAX_DEFERRED_QUEUE_SIZE) {
      this.pendingDeferredOverflowWarnings += 1
      this.startDeferredAttachLoop()
      return
    }
    this.deferredSessions.set(sessionId, {
      sessionId,
      title,
      queuedAt: new Date(),
      retryIsolatedContainer,
      mode,
    })
    this.deferredQueue.push(sessionId)
    this.deps.log("[tmux-session-manager] deferred session queued", {
      sessionId,
      queueLength: this.deferredQueue.length,
    })
    this.startDeferredAttachLoop()
  }

  private removeDeferredSession(sessionId: string): void {
    if (!this.deferredSessions.delete(sessionId)) return
    this.deferredQueue = this.deferredQueue.filter((id) => id !== sessionId)
    this.deps.log("[tmux-session-manager] deferred session removed", {
      sessionId,
      queueLength: this.deferredQueue.length,
    })
    if (this.deferredQueue.length === 0 && this.failedReadinessCache.size === 0) {
      this.stopDeferredAttachLoop()
    }
  }

  private startDeferredAttachLoop(): void {
    this.deferredAttachLoop.arm()
    this.deps.log("[tmux-session-manager] deferred attach polling started", {
      intervalMs: POLL_INTERVAL_BACKGROUND_MS,
    })
  }

  private stopDeferredAttachLoop(): void {
    this.deferredAttachLoop.stop()
    this.deps.log("[tmux-session-manager] deferred attach polling stopped")
  }

  private async runDeferredAttachTick(): Promise<DeferredDrainOutcome> {
    let outcome: DeferredDrainOutcome = "waiting"
    await this.enqueueSpawn(async () => {
      outcome = await this.tryAttachDeferredSession()
    })
    const expiredReadiness = this.failedReadinessCache.takeExpired()
    if (expiredReadiness.length > 0) {
      this.deps.log("[tmux-session-manager] subagent pane readiness retries expired", {
        kind: "warning",
        count: expiredReadiness.length,
        sessionIds: expiredReadiness.map((session) => session.sessionId),
      })
    }
    const readinessSessions = this.failedReadinessCache.values()
    for (const session of readinessSessions) {
      await this.retryFailedReadinessSession(session.sessionId)
    }
    if (readinessSessions.length > 0) outcome = "success"
    return outcome
  }

  private rememberFailedReadiness(session: FailedReadinessSessionSeed): void {
    this.failedReadinessCache.remember(session)
    this.startDeferredAttachLoop()
  }

  private expireDeferredSessions(): number {
    const now = Date.now()
    const expiredIds = this.deferredQueue.filter((sessionId) => {
      const deferred = this.deferredSessions.get(sessionId)
      return deferred !== undefined && now - deferred.queuedAt.getTime() > DEFERRED_SESSION_TTL_MS
    })
    if (expiredIds.length === 0) return 0
    const expiredSet = new Set(expiredIds)
    this.deferredQueue = this.deferredQueue.filter((sessionId) => !expiredSet.has(sessionId))
    for (const sessionId of expiredIds) this.deferredSessions.delete(sessionId)
    return expiredIds.length
  }

  private surfaceDeferredWarnings(expiredCount: number): void {
    const count = expiredCount + this.pendingDeferredOverflowWarnings
    if (count === 0) return
    this.pendingDeferredOverflowWarnings = 0
    this.deps.log("[tmux-session-manager] subagent panes deferred or expired", {
      kind: "warning",
      count,
      reason: "grid full",
    })
  }

  private beginPendingSession(
    sessionId: string,
    options?: { allowDeferredSession?: boolean },
  ): boolean {
    if (
      this.sessions.has(sessionId)
      || this.pendingSessions.has(sessionId)
      || (!options?.allowDeferredSession && this.deferredSessions.has(sessionId))
    ) {
      this.deps.log("[tmux-session-manager] session already tracked or pending", { sessionId })
      return false
    }

    this.pendingSessions.add(sessionId)
    return true
  }

  private async ensureSessionReadyBeforeSpawn(
    sessionId: string,
    stage: SpawnStage,
  ): Promise<boolean> {
    try {
      const ready = await this.deps.waitForSessionReady({
        client: this.client,
        sessionId,
      })

      if (ready) {
        return true
      }

      const readinessError = new Error("Session readiness timed out")
      this.deps.log("[tmux-session-manager] session readiness failed before spawn", {
        sessionId,
        stage,
        error: String(readinessError),
      })
      return false
    } catch (error) {
      this.deps.log("[tmux-session-manager] session readiness failed before spawn", {
        sessionId,
        stage,
        error: String(error),
      })
      return false
    }
  }

  private async getSessionStatusType(sessionId: string): Promise<string | undefined> {
    try {
      const statusResult = await this.client.session.status({ path: undefined })
      const allStatuses = parseSessionStatusResponse(statusResult)
      return allStatuses[sessionId]?.type
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to read session status before spawn", {
        sessionId,
        error: String(error),
      })
      return undefined
    }
  }

  private async spawnPendingSession(args: {
    session: FailedReadinessSessionSeed
    stage: SpawnStage
    rememberReadinessFailure: boolean
  }): Promise<void> {
    const { session, stage, rememberReadinessFailure } = args
    const { sessionId, title, mode } = session

    const readyForSpawn = await this.ensureSessionReadyBeforeSpawn(sessionId, stage)
    if (!readyForSpawn) {
      if (rememberReadinessFailure) {
        this.rememberFailedReadiness(session)
      }
      return
    }

    const sessionStatus = await this.getSessionStatusType(sessionId)
    if (!isAttachableSessionStatus(sessionStatus)) {
      this.deps.log("[tmux-session-manager] session not attachable for pane spawn", {
        sessionId,
        stage,
        status: sessionStatus,
      })
      if (rememberReadinessFailure) {
        this.rememberFailedReadiness(session)
      }
      return
    }

    this.failedReadinessCache.clear(sessionId)

    const isolatedSpawn = await this.spawnInIsolatedContainer(sessionId, title)
    if (isolatedSpawn.kind === "existing") return
    if (isolatedSpawn.kind === "spawned") {
      await this.addTrackedSession(session, isolatedSpawn.paneId)
      this.deps.log("[tmux-session-manager] first subagent spawned in isolated window", {
        sessionId,
        paneId: isolatedSpawn.paneId,
      })
      return
    }

    if (this.isIsolated() && !this.isolatedWindowPaneId) {
      this.deps.log("[tmux-session-manager] isolated container failed, deferring session for retry", { sessionId })
      this.enqueueDeferredSession(sessionId, title, mode, true)
      return
    }
    if (!this.getEffectiveSourcePaneId()) {
      this.deps.log("[tmux-session-manager] no effective source pane id")
      return
    }

    const stateResult = await this.queryEffectiveWindowState()
    if (stateResult.kind !== "ok") {
      this.deps.log("[tmux-session-manager] failed to query window state, deferring session")
      this.enqueueDeferredSession(sessionId, title, mode)
      return
    }
    const state = stateResult.state
    const sourcePaneId = this.getEffectiveSourcePaneId()
    if (!sourcePaneId) {
      this.enqueueDeferredSession(sessionId, title, mode)
      return
    }

    this.deps.log("[tmux-session-manager] window state queried", {
      windowWidth: state.windowWidth,
      mainPane: state.mainPane?.paneId,
      agentPaneCount: state.agentPanes.length,
      agentPanes: state.agentPanes.map((pane) => pane.paneId),
    })

    const decision = decideSpawnActions(
      state,
      sessionId,
      title,
      this.getCapacityConfig(),
      this.getSessionMappings(),
    )

    this.deps.log("[tmux-session-manager] spawn decision", {
      canSpawn: decision.canSpawn,
      reason: decision.reason,
      actionCount: decision.actions.length,
      actions: decision.actions.map((action) => {
        if (action.type === "close") return { type: "close", paneId: action.paneId }
        if (action.type === "replace") {
          return {
            type: "replace",
            paneId: action.paneId,
            newSessionId: action.newSessionId,
          }
        }
        return { type: "spawn", sessionId: action.sessionId }
      }),
    })

    if (!decision.canSpawn) {
      this.deps.log("[tmux-session-manager] cannot spawn", { reason: decision.reason })
      this.enqueueDeferredSession(sessionId, title, mode)
      return
    }

    const result = await this.executeDeduplicatedActions(sessionId, decision.actions, {
      config: this.tmuxConfig,
      directory: this.projectDirectory,
      serverUrl: this.serverUrl,
      windowState: state,
      sourcePaneId,
    })
    if (!result) return

    for (const { action, result: actionResult } of result.results) {
      if (action.type === "close" && actionResult.success) {
        this.sessions.delete(action.sessionId)
        this.deps.log("[tmux-session-manager] removed closed session from cache", {
          sessionId: action.sessionId,
        })
      }
      if (action.type === "replace" && actionResult.success) {
        this.sessions.delete(action.oldSessionId)
        this.deps.log("[tmux-session-manager] removed replaced session from cache", {
          oldSessionId: action.oldSessionId,
          newSessionId: action.newSessionId,
        })
      }
    }

    if (result.success && result.spawnedPaneId) {
      await this.addTrackedSession(session, result.spawnedPaneId)
      this.failedReadinessCache.clear(sessionId)
      this.deps.log("[tmux-session-manager] pane spawned and tracked", {
        sessionId,
        paneId: result.spawnedPaneId,
      })
      return
    }

    const spawnFailure = result.results.find(
      (entry) => entry.action.type === "spawn" && entry.result.tmuxFailure !== undefined,
    )?.result.tmuxFailure
    if (spawnFailure?.kind === "terminal") {
      if (classifyTmuxError(spawnFailure.stderr) !== "target_gone") {
        this.deps.log("[tmux-session-manager] terminal pane spawn failure", {
          kind: "warning",
          sessionId,
          error: result.results.find((entry) => entry.result.tmuxFailure === spawnFailure)?.result.error,
        })
        return
      }

      const recovered = await this.sourcePaneRecovery.recoverAfterTargetLoss()
      const recoveredSourcePaneId = this.getEffectiveSourcePaneId()
      if (recovered.kind !== "ok" || !recoveredSourcePaneId) {
        this.enqueueDeferredSession(sessionId, title, mode)
        return
      }
      const retryDecision = decideSpawnActions(
        recovered.state,
        sessionId,
        title,
        this.getCapacityConfig(),
        this.getSessionMappings(),
      )
      if (!retryDecision.canSpawn || retryDecision.actions.length === 0) {
        this.enqueueDeferredSession(sessionId, title, mode)
        return
      }
      const retryResult = await this.executeDeduplicatedActions(sessionId, retryDecision.actions, {
        config: this.tmuxConfig,
        directory: this.projectDirectory,
        serverUrl: this.serverUrl,
        windowState: recovered.state,
        sourcePaneId: recoveredSourcePaneId,
      })
      if (!retryResult) return
      if (retryResult.success && retryResult.spawnedPaneId) {
        await this.addTrackedSession(session, retryResult.spawnedPaneId)
        this.failedReadinessCache.clear(sessionId)
        return
      }
      this.enqueueDeferredSession(sessionId, title, mode)
      return
    }

    this.deps.log("[tmux-session-manager] spawn failed", {
      success: result.success,
      results: result.results.map((resultEntry) => ({
        type: resultEntry.action.type,
        success: resultEntry.result.success,
        error: resultEntry.result.error,
      })),
    })

    this.deps.log("[tmux-session-manager] re-queueing deferred session after spawn failure", {
      sessionId,
    })
    this.enqueueDeferredSession(sessionId, title, mode)

    if (result.spawnedPaneId) {
      await this.deps.executeAction(
        { type: "close", paneId: result.spawnedPaneId, sessionId },
        {
          config: this.tmuxConfig,
          directory: this.projectDirectory,
          serverUrl: this.serverUrl,
          windowState: state,
        },
      )
    }
  }

  private async executeDeduplicatedActions(
    sessionId: string,
    actions: PaneAction[],
    context: ExecuteContext,
  ): Promise<ExecuteActionsResult | null> {
    const outcome = await this.sessionPaneDeduplicator.run(
      sessionId,
      () => this.deps.executeActions(actions, context),
      (result) => result.spawnedPaneId,
    )
    switch (outcome.kind) {
      case "spawned":
        return outcome.result
      case "discarded":
        return { ...outcome.result, success: false }
      case "existing":
        this.deps.log("[tmux-session-manager] pane spawn skipped because session already has a tmux pane", {
          sessionId,
          paneId: outcome.paneId,
        })
        return null
      default:
        return assertNever(outcome)
    }
  }

  private getEventSessionId(event: {
    type: string
    properties?: Record<string, unknown>
  }): string | undefined {
    const sessionId = event.properties?.sessionID
    return typeof sessionId === "string" ? sessionId : undefined
  }

  private async retryFailedReadinessSession(sessionId: string): Promise<void> {
    if (this.shouldSkipRespawnAfterPollingClose(sessionId, "session.idle retry")) {
      return
    }

    const expired = this.failedReadinessCache.takeExpired()
    if (expired.length > 0) {
      this.deps.log("[tmux-session-manager] subagent pane readiness retries expired", {
        kind: "warning",
        count: expired.length,
        sessionIds: expired.map((session) => session.sessionId),
      })
    }
    const failedReadinessSession = this.failedReadinessCache.get(sessionId)
    if (!failedReadinessSession) {
      return
    }

    if (!this.beginPendingSession(sessionId)) {
      return
    }

    try {
      await this.enqueueSpawn(async () => {
        try {
          const sessionStatus = await this.getSessionStatusType(sessionId)
          if (!isAttachableSessionStatus(sessionStatus)) {
            this.deps.log("[tmux-session-manager] session.idle retry skipped because session is not attachable", {
              sessionId,
              status: sessionStatus,
            })
            return
          }

          await this.spawnPendingSession({
            session: failedReadinessSession,
            stage: "session.idle.retry",
            rememberReadinessFailure: false,
          })
        } finally {
          this.pendingSessions.delete(sessionId)
        }
      })
    } finally {
      this.pendingSessions.delete(sessionId)
    }
  }

  private async tryAttachDeferredSession(): Promise<DeferredDrainOutcome> {
    const expiredCount = this.expireDeferredSessions()
    this.surfaceDeferredWarnings(expiredCount)
    const sessionId = this.deferredQueue[0]
    if (!sessionId) {
      if (this.failedReadinessCache.size === 0) this.stopDeferredAttachLoop()
      return "success"
    }

    const deferred = this.deferredSessions.get(sessionId)
    if (!deferred) {
      this.deferredQueue.shift()
      return "success"
    }

    if (this.shouldSkipRespawnAfterPollingClose(sessionId, "deferred attach")) {
      this.removeDeferredSession(sessionId)
      return "success"
    }

    if (!this.beginPendingSession(sessionId, { allowDeferredSession: true })) {
      return "waiting"
    }

    try {
      if (deferred.retryIsolatedContainer) {
        const readyForIsolatedContainer = await this.ensureSessionReadyBeforeSpawn(
          sessionId,
          "deferred.isolated-container",
        )
        if (!readyForIsolatedContainer) {
          this.removeDeferredSession(sessionId)
          return "success"
        }

        const isolatedSpawn = await this.spawnInIsolatedContainer(sessionId, deferred.title)
        if (isolatedSpawn.kind === "existing") {
          this.removeDeferredSession(sessionId)
          return "success"
        }
        if (isolatedSpawn.kind === "spawned") {
          await this.addTrackedSession(deferred, isolatedSpawn.paneId)
          this.removeDeferredSession(sessionId)
          this.deps.log("[tmux-session-manager] deferred session attached in isolated window", {
            sessionId,
            paneId: isolatedSpawn.paneId,
          })
          return "success"
        }
      }

      if (!this.getEffectiveSourcePaneId()) return "waiting"

      const stateResult = await this.queryEffectiveWindowState()
      if (stateResult.kind === "transient") {
        this.deps.log("[tmux-session-manager] deferred attach window state transient", { detail: stateResult.detail })
        return "transient"
      }
      if (stateResult.kind === "source_gone") return "waiting"
      const state = stateResult.state
      const effectiveSourcePaneId = this.getEffectiveSourcePaneId()
      if (!effectiveSourcePaneId) return "waiting"

      const decision = decideSpawnActions(
        state,
        sessionId,
        deferred.title,
        this.getCapacityConfig(),
        this.getSessionMappings(),
      )

      if (!decision.canSpawn || decision.actions.length === 0) {
        this.deps.log("[tmux-session-manager] deferred session still waiting for capacity", {
          sessionId,
          reason: decision.reason,
        })
        return "success"
      }

      const readyForDeferredAttach = await this.ensureSessionReadyBeforeSpawn(
        sessionId,
        "deferred.attach",
      )
      if (!readyForDeferredAttach) {
        this.removeDeferredSession(sessionId)
        return "success"
      }

      const result = await this.executeDeduplicatedActions(sessionId, decision.actions, {
        config: this.tmuxConfig,
        directory: this.projectDirectory,
        serverUrl: this.serverUrl,
        windowState: state,
        sourcePaneId: effectiveSourcePaneId,
      })
      if (!result) {
        this.removeDeferredSession(sessionId)
        return "success"
      }

      if (!result.success || !result.spawnedPaneId) {
        this.deps.log("[tmux-session-manager] deferred session attach failed", {
          sessionId,
          results: result.results.map((r) => ({
            type: r.action.type,
            success: r.result.success,
            error: r.result.error,
          })),
        })
        return "transient"
      }

      await this.addTrackedSession(deferred, result.spawnedPaneId)
      this.removeDeferredSession(sessionId)
      this.deps.log("[tmux-session-manager] deferred session attached", {
        sessionId,
        paneId: result.spawnedPaneId,
      })
      return "success"
    } finally {
      this.pendingSessions.delete(sessionId)
    }
  }

  private async startTrackingSession(
    session: FailedReadinessSessionSeed,
    stage: SpawnStage,
  ): Promise<void> {
    if (!this.getEffectiveSourcePaneId()) {
      this.deps.log("[tmux-session-manager] no source pane id")
      return
    }

    if (!this.beginPendingSession(session.sessionId)) return

    try {
      await this.retryPendingCloses()
      await this.enqueueSpawn(async () => {
        try {
          await this.spawnPendingSession({
            session,
            stage,
            rememberReadinessFailure: true,
          })
        } finally {
          this.pendingSessions.delete(session.sessionId)
        }
      })
    } finally {
      this.pendingSessions.delete(session.sessionId)
    }
  }

  async observeSession(sessionId: string, title: string): Promise<void> {
    if (!this.isEnabled()) return

    await this.sweepStaleIsolatedSessionsOnce()
    await this.startTrackingSession({ sessionId, title, mode: "observe-only" }, "session.observe")
  }

  async onSessionCreated(event: SessionCreatedEvent): Promise<void> {
    const enabled = this.isEnabled()
    this.deps.log("[tmux-session-manager] onSessionCreated called", {
      enabled,
      tmuxConfigEnabled: this.tmuxConfig.enabled,
      isInsideTmux: this.deps.isInsideTmux(),
      eventType: event.type,
      infoId: event.properties?.info?.id,
      infoParentID: event.properties?.info?.parentID,
    })

    if (!enabled) return
    if (event.type !== "session.created") return

    const info = event.properties?.info
    const sessionId = resolveSessionEventID(event.properties)
    if (!sessionId || !info?.parentID) return

    await this.sweepStaleIsolatedSessionsOnce()

    // Team-mode members live in `team-layout-tmux` (which owns the pane
    // lifecycle via runtimeState.tmuxLayout). Tracking them here as well
    // produces two managers fighting over the same pane: polling can close a
    // pane while team-layout is still rendering into it, and the subagent
    // panel surfaces a duplicate row that's already represented in team_status.
    if (this.shouldSkipSession(sessionId)) {
      this.deps.log("[tmux-session-manager] onSessionCreated skipped via shouldSkipSession", {
        sessionId,
        parentID: info.parentID,
      })
      return
    }

    const title = info.title ?? "Subagent"
    await this.startTrackingSession({ sessionId, title, mode: "interactive" }, "session.created")
  }

  private async enqueueSpawn(run: () => Promise<void>): Promise<void> {
    this.spawnQueue = this.spawnQueue
      .catch((error) => {
        this.deps.log("[tmux-session-manager] recovering spawn queue after previous failure", {
          error: String(error),
        })
      })
      .then(run)
      .catch((err) => {
        this.deps.log("[tmux-session-manager] spawn queue task failed", {
          error: String(err),
        })
      })
    await this.spawnQueue
  }

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    if (!this.isEnabled()) return

    this.closedByPolling.delete(event.sessionID)
    this.failedReadinessCache.clear(event.sessionID)
    this.removeDeferredSession(event.sessionID)
    if (this.deferredQueue.length === 0 && this.failedReadinessCache.size === 0) {
      this.stopDeferredAttachLoop()
    }

    if (!this.getEffectiveSourcePaneId()) return

    const tracked = this.sessions.get(event.sessionID)
    if (!tracked) return

    this.deps.log("[tmux-session-manager] onSessionDeleted", { sessionId: event.sessionID })

    const state = await this.queryWindowStateSafely()
    if (!state) {
      this.markSessionClosePending(event.sessionID)
      return
    }

    const closeAction = decideCloseAction(state, event.sessionID, this.getSessionMappings())
    if (!closeAction) {
      await this.finalizeTrackedSessionClose({
        tracked,
        state,
        isolatedPaneAlreadyClosed: false,
      })
      return
    }

    const isolatedPaneAlreadyClosed =
      closeAction.type === "close" && closeAction.paneId === tracked.paneId

    try {
      const result = await this.deps.executeAction(closeAction, {
        config: this.tmuxConfig,
        directory: this.projectDirectory,
        serverUrl: this.serverUrl,
        windowState: state,
        sourcePaneId: this.getEffectiveSourcePaneId(),
      })

      if (!result.success) {
        this.markSessionClosePending(event.sessionID)
        return
      }
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to close pane for deleted session", {
        sessionId: event.sessionID,
        error: String(error),
      })
      this.markSessionClosePending(event.sessionID)
      return
    }

    await this.finalizeTrackedSessionClose({
      tracked,
      state,
      isolatedPaneAlreadyClosed,
    })
  }


  private async closeSessionById(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    if (tracked.closePending && tracked.closeRetryCount >= MAX_CLOSE_RETRY_COUNT) {
      await this.finalizeForceRemoveCandidate(tracked, "closeSessionById.max-retries")
      return
    }

    this.deps.log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    })

    const closed = await this.closeTrackedSession(tracked)
    if (!closed) {
      this.markSessionClosePending(sessionId)
      return
    }
  }

  private async closeSessionFromPolling(sessionId: string): Promise<void> {
    this.closedByPolling.add(sessionId)
    await this.closeSessionById(sessionId)
  }

  private shouldSkipRespawnAfterPollingClose(sessionId: string, source: string): boolean {
    if (!this.closedByPolling.has(sessionId)) {
      return false
    }

    this.deps.log("[tmux-session-manager] skipping tmux respawn because polling already closed the session", {
      sessionId,
      source,
    })
    return true
  }

  onEvent(event: { type: string; properties?: Record<string, unknown> }): void {
    this.pollingManager.handleEvent(event)

    const sessionId = this.getEventSessionId(event)
    if (event.type !== "session.idle" || !sessionId) {
      return
    }

    void this.retryFailedReadinessSession(sessionId).catch((error) => {
      this.deps.log("[tmux-session-manager] session.idle retry failed", {
        sessionId,
        error: String(error),
      })
    })
  }

  createEventHandler(): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
    return async (input) => {
      await this.onSessionCreated(input.event as SessionCreatedEvent)
    }
  }

  async cleanup(): Promise<void> {
    this.stopDeferredAttachLoop()
    this.deferredQueue = []
    this.deferredSessions.clear()
    this.closedByPolling.clear()
    this.failedReadinessCache.clearAll()
    this.pollingManager.stopPolling()

    if (this.sessions.size > 0) {
      this.deps.log("[tmux-session-manager] closing all panes", { count: this.sessions.size })

      const sessionIds = Array.from(this.sessions.keys())
      for (const sessionId of sessionIds) {
        try {
          await this.closeSessionById(sessionId)
        } catch (error) {
          this.deps.log("[tmux-session-manager] cleanup error for pane", {
            sessionId,
            error: String(error),
          })
        }
      }
    }

    await this.retryPendingCloses()
    this.isolatedContainerNullStateCount = 0
    this.isolatedContainerPaneId = undefined
    this.isolatedWindowPaneId = undefined

    if (this.tmuxConfig.isolation === "session") {
      const isolatedSessionName = getIsolatedSessionName(process.pid, this.isolatedSessionManagerId)
      try {
        const killed = await killTmuxSessionIfExists(isolatedSessionName)
        this.deps.log("[tmux-session-manager] isolated session teardown", {
          session: isolatedSessionName,
          killed,
        })
      } catch (error) {
        this.deps.log("[tmux-session-manager] isolated session teardown failed", {
          session: isolatedSessionName,
          error: String(error),
        })
      }
    }

    this.staleSweepCompleted = false
    this.staleSweepInProgress = false

    this.deps.log("[tmux-session-manager] cleanup complete")
  }

  private async sweepStaleIsolatedSessionsOnce(): Promise<void> {
    if (this.staleSweepCompleted) return
    if (this.staleSweepInProgress) return

    this.staleSweepInProgress = true
    try {
      const report = await sweepStaleTmuxResources({
        isolation: this.tmuxConfig.isolation,
        sweepStaleOmoAgentSessions,
        sweepStaleOmoAttachPanes,
      })
      if (report.killed > 0) {
        this.deps.log("[tmux-session-manager] stale tmux resources swept", {
          killed: report.killed,
          killedAttachPanes: report.killedAttachPanes,
          killedIsolatedSessions: report.killedIsolatedSessions,
        })
      }
      this.staleSweepCompleted = true
    } catch (error) {
      this.deps.log("[tmux-session-manager] stale sweep failed", {
        error: String(error),
      })
    } finally {
      this.staleSweepInProgress = false
    }
  }
}

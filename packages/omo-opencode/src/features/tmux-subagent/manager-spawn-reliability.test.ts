import { describe, expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TmuxConfig } from "../../config/schema"
import type { ExecuteActionsResult, ExecuteContext } from "./action-executor"
import { TmuxSessionManager, type TmuxUtilDeps } from "./manager"
import type { PaneAction, WindowState, WindowStateQueryResult } from "./types"

const config = {
  enabled: true,
  isolation: "inline",
  layout: "main-vertical",
  main_pane_size: 60,
  main_pane_min_width: 80,
  agent_pane_min_width: 40,
} satisfies TmuxConfig

function state(windowId: string, activePaneId: string, agentPaneIds: readonly string[] = []): WindowState {
  return {
    windowId,
    windowWidth: 220,
    windowHeight: 44,
    windowActive: true,
    sessionAttached: true,
    mainPane: {
      paneId: activePaneId,
      width: 110,
      height: 44,
      left: 0,
      top: 0,
      title: "main",
      isActive: true,
    },
    agentPanes: agentPaneIds.map((paneId, index) => ({
      paneId,
      width: 55,
      height: 44,
      left: 110 + index * 55,
      top: 0,
      title: "agent",
      isActive: false,
    })),
  }
}

type ManagerInternals = {
  readonly spawnPendingSession: (args: {
    readonly session: { readonly sessionId: string; readonly title: string; readonly mode: "interactive" }
    readonly stage: "session.created"
    readonly rememberReadinessFailure: boolean
  }) => Promise<void>
  readonly sessions: Map<string, unknown>
  readonly pollingManager: { stopPolling: () => void }
  readonly enqueueDeferredSession: (sessionId: string, title: string, mode: "interactive") => void
  readonly tryAttachDeferredSession: () => Promise<unknown>
  readonly deferredQueue: string[]
  readonly deferredSessions: Map<string, { queuedAt: Date }>
  readonly runDeferredAttachTick: () => Promise<unknown>
  readonly enqueueSpawn: (run: () => Promise<void>) => Promise<void>
  readonly failedReadinessCache: { readonly size: number }
  readonly deferredAttachLoop: {
    stop: () => void
    getState: () => { readonly scheduled: boolean; readonly draining: boolean; readonly consecutiveTransientFailures: number }
  }
}

describe("TmuxSessionManager spawn reliability", () => {
  test("#given captured source %1 closes after original window is known #when next spawn runs #then manager resolves %5 once without rereading environment", async () => {
    // given
    const queryResults: WindowStateQueryResult[] = [
      { kind: "ok", state: state("@7", "%1") },
      { kind: "source_gone" },
      { kind: "ok", state: state("@7", "%5", ["%9"]) },
    ]
    const queriedTargets: string[] = []
    const getCurrentPaneId = mock(() => "%1")
    let spawnIndex = 0
    const executeActions = mock(async (actions: PaneAction[], context: ExecuteContext): Promise<ExecuteActionsResult> => {
      spawnIndex += 1
      const paneId = spawnIndex === 1 ? "%9" : "%10"
      return {
        success: true,
        spawnedPaneId: paneId,
        results: actions.map((action) => ({ action, result: { success: true, paneId } })),
      }
    })
    const deps: TmuxUtilDeps = {
      isInsideTmux: () => true,
      getCurrentPaneId,
      queryWindowState: async (target) => {
        queriedTargets.push(target)
        const result = queryResults.shift()
        if (!result) throw new Error("Missing query result")
        return result
      },
      waitForSessionReady: async () => true,
      executeActions,
      executeAction: async () => ({ success: true }),
      activateTmuxPane: async () => true,
      activateReadOnlyTmuxPane: async () => true,
      log: () => undefined,
    }
    const context = unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: {
        session: {
          status: async () => ({ data: { first: { type: "running" }, second: { type: "running" } } }),
          messages: async () => ({ data: [] }),
        },
      },
    })
    const manager = new TmuxSessionManager(context, config, deps)
    const internals = unsafeTestValue<ManagerInternals>(manager)

    // when
    await internals.spawnPendingSession({
      session: { sessionId: "first", title: "first", mode: "interactive" },
      stage: "session.created",
      rememberReadinessFailure: true,
    })
    await internals.spawnPendingSession({
      session: { sessionId: "second", title: "second", mode: "interactive" },
      stage: "session.created",
      rememberReadinessFailure: true,
    })

    // then
    expect(getCurrentPaneId).toHaveBeenCalledTimes(1)
    expect(queriedTargets).toEqual(["%1", "%1", "@7"])
    expect(executeActions).toHaveBeenCalledTimes(2)
    expect(executeActions.mock.calls[1]?.[1]?.sourcePaneId).toBe("%5")

    internals.sessions.clear()
    internals.pollingManager.stopPolling()
  })

  test("#given four capacity-deferred sessions exceed TTL #when one drain runs #then all expire with one visible aggregated warning", async () => {
    // given
    const log = mock((_message: string, _data?: unknown) => undefined)
    const deps: TmuxUtilDeps = {
      isInsideTmux: () => true,
      getCurrentPaneId: () => "%1",
      queryWindowState: async () => ({ kind: "ok", state: state("@7", "%1") }),
      waitForSessionReady: async () => true,
      executeActions: async () => ({ success: true, results: [] }),
      executeAction: async () => ({ success: true }),
      activateTmuxPane: async () => true,
      activateReadOnlyTmuxPane: async () => true,
      log,
    }
    const context = unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: { session: { status: async () => ({ data: {} }), messages: async () => ({ data: [] }) } },
    })
    const manager = new TmuxSessionManager(context, config, deps)
    const internals = unsafeTestValue<ManagerInternals>(manager)
    for (let index = 0; index < 4; index += 1) {
      const sessionId = `deferred-${index}`
      internals.enqueueDeferredSession(sessionId, sessionId, "interactive")
      const deferred = internals.deferredSessions.get(sessionId)
      if (!deferred) throw new Error("Expected deferred session")
      deferred.queuedAt = new Date(Date.now() - 5 * 60 * 1_000 - 1)
    }

    // when
    await internals.tryAttachDeferredSession()

    // then
    expect(internals.deferredQueue).toEqual([])
    const warnings = log.mock.calls.filter((call) => {
      const data: unknown = call[1]
      return typeof data === "object" && data !== null && Reflect.get(data, "kind") === "warning"
    })
    expect(warnings).toHaveLength(1)
    const warning = warnings[0]?.[1]
    expect(typeof warning === "object" && warning !== null ? Reflect.get(warning, "count") : undefined).toBe(4)
    expect(typeof warning === "object" && warning !== null ? Reflect.get(warning, "reason") : undefined).toBe("grid full")

    internals.pollingManager.stopPolling()
  })

  test("#given readiness timeout and no idle event #when heartbeat drains #then pane spawns once and retry cache clears", async () => {
    // given
    let readinessAttempt = 0
    const executeActions = mock(async (actions: PaneAction[]): Promise<ExecuteActionsResult> => ({
      success: true,
      spawnedPaneId: "%9",
      results: actions.map((action) => ({ action, result: { success: true, paneId: "%9" } })),
    }))
    const deps: TmuxUtilDeps = {
      isInsideTmux: () => true,
      getCurrentPaneId: () => "%1",
      queryWindowState: async () => ({ kind: "ok", state: state("@7", "%1") }),
      waitForSessionReady: async () => {
        readinessAttempt += 1
        return readinessAttempt > 1
      },
      executeActions,
      executeAction: async () => ({ success: true }),
      activateTmuxPane: async () => true,
      activateReadOnlyTmuxPane: async () => true,
      log: () => undefined,
    }
    const context = unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: {
        session: {
          status: async () => ({ data: { retry: { type: "running" } } }),
          messages: async () => ({ data: [] }),
        },
      },
    })
    const manager = new TmuxSessionManager(context, config, deps)
    const internals = unsafeTestValue<ManagerInternals>(manager)
    await internals.spawnPendingSession({
      session: { sessionId: "retry", title: "retry", mode: "interactive" },
      stage: "session.created",
      rememberReadinessFailure: true,
    })

    // when
    const scheduledAfterTimeout = internals.deferredAttachLoop.getState().scheduled
    internals.deferredAttachLoop.stop()
    await internals.runDeferredAttachTick()

    // then
    expect(scheduledAfterTimeout).toBe(true)
    expect(executeActions).toHaveBeenCalledTimes(1)
    expect(internals.failedReadinessCache.size).toBe(0)

    internals.sessions.clear()
    internals.pollingManager.stopPolling()
  })

  test("#given split-window loses source target #when spawn fails #then manager re-resolves once and retries with replacement", async () => {
    // given
    const queryResults: WindowStateQueryResult[] = [
      { kind: "ok", state: state("@7", "%1") },
      { kind: "ok", state: state("@7", "%5") },
    ]
    const executeActions = mock(async (actions: PaneAction[], context: ExecuteContext): Promise<ExecuteActionsResult> => {
      if (executeActions.mock.calls.length === 1) {
        const action = actions[0]
        if (!action) throw new Error("Expected spawn action")
        return {
          success: false,
          results: [{ action, result: { success: false, error: "can't find pane: %1", tmuxFailure: { kind: "terminal", stderr: "can't find pane: %1" } } }],
        }
      }
      const action = actions[0]
      if (!action) throw new Error("Expected retry action")
      return { success: true, spawnedPaneId: "%9", results: [{ action, result: { success: true, paneId: "%9" } }] }
    })
    const deps: TmuxUtilDeps = {
      isInsideTmux: () => true,
      getCurrentPaneId: () => "%1",
      queryWindowState: async () => queryResults.shift() ?? { kind: "source_gone" },
      waitForSessionReady: async () => true,
      executeActions,
      executeAction: async () => ({ success: true }),
      activateTmuxPane: async () => true,
      activateReadOnlyTmuxPane: async () => true,
      log: () => undefined,
    }
    const context = unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: { session: { status: async () => ({ data: { target: { type: "running" } } }), messages: async () => ({ data: [] }) } },
    })
    const manager = new TmuxSessionManager(context, config, deps)
    const internals = unsafeTestValue<ManagerInternals>(manager)

    // when
    await internals.spawnPendingSession({
      session: { sessionId: "target", title: "target", mode: "interactive" },
      stage: "session.created",
      rememberReadinessFailure: true,
    })

    // then
    expect(executeActions).toHaveBeenCalledTimes(2)
    expect(executeActions.mock.calls[1]?.[1]?.sourcePaneId).toBe("%5")
    expect(internals.deferredQueue).toEqual([])

    internals.sessions.clear()
    internals.pollingManager.stopPolling()
  })

  test("#given initial, deferred, readiness, and command-retry work #when all enter spawnQueue #then tmux mutation concurrency stays one", async () => {
    // given
    const deps: TmuxUtilDeps = {
      isInsideTmux: () => true,
      getCurrentPaneId: () => "%1",
      queryWindowState: async () => ({ kind: "ok", state: state("@7", "%1") }),
      waitForSessionReady: async () => true,
      executeActions: async () => ({ success: true, results: [] }),
      executeAction: async () => ({ success: true }),
      activateTmuxPane: async () => true,
      activateReadOnlyTmuxPane: async () => true,
      log: () => undefined,
    }
    const context = unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: { session: { status: async () => ({ data: {} }), messages: async () => ({ data: [] }) } },
    })
    const manager = new TmuxSessionManager(context, config, deps)
    const internals = unsafeTestValue<ManagerInternals>(manager)
    let active = 0
    let maxActive = 0
    const paths = ["initial", "deferred", "readiness", "command-retry"]

    // when
    await Promise.all(paths.map(() => internals.enqueueSpawn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
    })))

    // then
    expect(maxActive).toBe(1)
  })

  test("#given six visible sessions, two transient queries, and stale source #when deferred heartbeats drain #then all six eventually spawn and loop remains reusable", async () => {
    // given
    const queryResults: WindowStateQueryResult[] = [
      { kind: "ok", state: state("@7", "%1") },
      { kind: "ok", state: state("@7", "%1") },
      { kind: "transient", detail: "server transient one" },
      { kind: "transient", detail: "server transient two" },
      { kind: "source_gone" },
      { kind: "ok", state: state("@7", "%5") },
      { kind: "ok", state: state("@7", "%5") },
      { kind: "ok", state: state("@7", "%5") },
      { kind: "ok", state: state("@7", "%5") },
    ]
    let paneIndex = 10
    const executeActions = mock(async (actions: PaneAction[]): Promise<ExecuteActionsResult> => {
      const paneId = `%${paneIndex}`
      paneIndex += 1
      return { success: true, spawnedPaneId: paneId, results: actions.map((action) => ({ action, result: { success: true, paneId } })) }
    })
    const deps: TmuxUtilDeps = {
      isInsideTmux: () => true,
      getCurrentPaneId: () => "%1",
      queryWindowState: async () => queryResults.shift() ?? { kind: "ok", state: state("@7", "%5") },
      waitForSessionReady: async () => true,
      executeActions,
      executeAction: async () => ({ success: true }),
      activateTmuxPane: async () => true,
      activateReadOnlyTmuxPane: async () => true,
      log: () => undefined,
    }
    const statuses = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`burst-${index}`, { type: "running" }]))
    const context = unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: { session: { status: async () => ({ data: statuses }), messages: async () => ({ data: [] }) } },
    })
    const manager = new TmuxSessionManager(context, config, deps)
    const internals = unsafeTestValue<ManagerInternals>(manager)

    // when
    for (let index = 0; index < 6; index += 1) {
      await internals.spawnPendingSession({
        session: { sessionId: `burst-${index}`, title: `burst-${index}`, mode: "interactive" },
        stage: "session.created",
        rememberReadinessFailure: true,
      })
    }
    await internals.runDeferredAttachTick()
    await internals.runDeferredAttachTick()

    // then
    expect(executeActions).toHaveBeenCalledTimes(6)
    expect(internals.sessions.size).toBe(6)
    expect(internals.deferredQueue).toEqual([])
    expect(internals.deferredAttachLoop.getState().draining).toBe(false)

    internals.sessions.clear()
    internals.deferredAttachLoop.stop()
    internals.pollingManager.stopPolling()
  })
})

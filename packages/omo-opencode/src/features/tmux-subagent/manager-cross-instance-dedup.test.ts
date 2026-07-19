import { expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TmuxConfig } from "../../config/schema"
import type { ExecuteActionsResult } from "./action-executor"
import { TmuxSessionManager, type TmuxUtilDeps } from "./manager"
import type { SessionPaneDeduplicator } from "./session-pane-deduplicator"
import type { PaneAction, WindowState } from "./types"

type ManagerInternals = {
  readonly enqueueDeferredSession: (sessionId: string, title: string, mode: "interactive") => void
  readonly tryAttachDeferredSession: () => Promise<unknown>
  readonly deferredAttachLoop: { readonly stop: () => void }
}

const config = {
  enabled: true,
  isolation: "inline",
  layout: "main-vertical",
  main_pane_size: 60,
  main_pane_min_width: 80,
  agent_pane_min_width: 40,
} satisfies TmuxConfig

const windowState: WindowState = {
  windowId: "@7",
  windowWidth: 220,
  windowHeight: 44,
  windowActive: true,
  sessionAttached: true,
  mainPane: {
    paneId: "%1",
    width: 110,
    height: 44,
    left: 0,
    top: 0,
    title: "main",
    isActive: true,
  },
  agentPanes: [],
}

function context(): ConstructorParameters<typeof TmuxSessionManager>[0] {
  return unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
    directory: "/tmp/project",
    serverUrl: new URL("http://127.0.0.1:4096"),
    client: {
      session: {
        status: async () => ({ data: { ses_shared: { type: "running" } } }),
        messages: async () => ({ data: [] }),
      },
    },
  })
}

function createSharedDeduplicator(): SessionPaneDeduplicator {
  let ownerPaneId: string | undefined
  let queue = Promise.resolve()

  return {
    run<T>(
      _sessionId: string,
      spawn: () => Promise<T>,
      getSpawnedPaneId: (result: T) => string | undefined,
    ) {
      const operation = queue.then(async () => {
        if (ownerPaneId) return { kind: "existing" as const, paneId: ownerPaneId }
        const result = await spawn()
        ownerPaneId = getSpawnedPaneId(result)
        return { kind: "spawned" as const, result }
      })
      queue = operation.then(() => undefined)
      return operation
    },
  }
}

test("#given two manager instances share tmux ownership #when both receive one session-created event #then only one split executes", async () => {
  // given
  const deduplicator = createSharedDeduplicator()
  const executeActions = mock(async (actions: PaneAction[]): Promise<ExecuteActionsResult> => ({
    success: true,
    spawnedPaneId: "%9",
    results: actions.map((action) => ({ action, result: { success: true, paneId: "%9" } })),
  }))
  const deps = {
    isInsideTmux: () => true,
    getCurrentPaneId: () => "%1",
    queryWindowState: async () => ({ kind: "ok" as const, state: windowState }),
    waitForSessionReady: async () => true,
    executeActions,
    executeAction: async () => ({ success: true }),
    activateTmuxPane: async () => true,
    activateReadOnlyTmuxPane: async () => true,
    sessionPaneDeduplicator: deduplicator,
    log: () => undefined,
  } satisfies TmuxUtilDeps
  const first = new TmuxSessionManager(context(), config, deps)
  const second = new TmuxSessionManager(context(), config, deps)
  const event = {
    type: "session.created",
    properties: { info: { id: "ses_shared", parentID: "ses_parent", title: "shared" } },
  }

  // when
  await Promise.all([first.onSessionCreated(event), second.onSessionCreated(event)])

  // then
  expect(executeActions).toHaveBeenCalledTimes(1)
  expect([first.getTrackedPaneId("ses_shared"), second.getTrackedPaneId("ses_shared")].filter(Boolean)).toEqual(["%9"])

  await first.cleanup()
  await second.cleanup()
})

test("#given two managers defer the same session #when both capacity loops retry #then only one placeholder split executes", async () => {
  // given
  const deduplicator = createSharedDeduplicator()
  const executeActions = mock(async (actions: PaneAction[]): Promise<ExecuteActionsResult> => ({
    success: true,
    spawnedPaneId: "%10",
    results: actions.map((action) => ({ action, result: { success: true, paneId: "%10" } })),
  }))
  const deps = {
    isInsideTmux: () => true,
    getCurrentPaneId: () => "%1",
    queryWindowState: async () => ({ kind: "ok" as const, state: windowState }),
    waitForSessionReady: async () => true,
    executeActions,
    executeAction: async () => ({ success: true }),
    activateTmuxPane: async () => true,
    activateReadOnlyTmuxPane: async () => true,
    sessionPaneDeduplicator: deduplicator,
    log: () => undefined,
  } satisfies TmuxUtilDeps
  const first = new TmuxSessionManager(context(), config, deps)
  const second = new TmuxSessionManager(context(), config, deps)
  const firstInternals = unsafeTestValue<ManagerInternals>(first)
  const secondInternals = unsafeTestValue<ManagerInternals>(second)
  firstInternals.enqueueDeferredSession("ses_shared", "shared", "interactive")
  secondInternals.enqueueDeferredSession("ses_shared", "shared", "interactive")
  firstInternals.deferredAttachLoop.stop()
  secondInternals.deferredAttachLoop.stop()

  // when
  await Promise.all([
    firstInternals.tryAttachDeferredSession(),
    secondInternals.tryAttachDeferredSession(),
  ])

  // then
  expect(executeActions).toHaveBeenCalledTimes(1)
  expect([first.getTrackedPaneId("ses_shared"), second.getTrackedPaneId("ses_shared")].filter(Boolean)).toEqual(["%10"])

  await first.cleanup()
  await second.cleanup()
})

test("#given source recovery finds a sibling-owned pane #when retry reaches the split seam #then retry skips its split", async () => {
  // given
  const recoveredMainPane = windowState.mainPane
  if (!recoveredMainPane) throw new Error("Expected main pane")
  let queryCount = 0
  let dedupCalls = 0
  const deduplicator: SessionPaneDeduplicator = {
    async run<T>(_sessionId: string, spawn: () => Promise<T>) {
      dedupCalls += 1
      if (dedupCalls === 2) return { kind: "existing", paneId: "%8" }
      return { kind: "spawned", result: await spawn() }
    },
  }
  const executeActions = mock(async (actions: PaneAction[]): Promise<ExecuteActionsResult> => {
    const action = actions[0]
    if (!action) throw new Error("Expected spawn action")
    return {
      success: false,
      results: [{
        action,
        result: {
          success: false,
          error: "can't find pane: %1",
          tmuxFailure: { kind: "terminal", stderr: "can't find pane: %1" },
        },
      }],
    }
  })
  const deps = {
    isInsideTmux: () => true,
    getCurrentPaneId: () => "%1",
    queryWindowState: async () => {
      queryCount += 1
      return {
        kind: "ok" as const,
        state: queryCount === 1
          ? windowState
          : { ...windowState, mainPane: { ...recoveredMainPane, paneId: "%5" } },
      }
    },
    waitForSessionReady: async () => true,
    executeActions,
    executeAction: async () => ({ success: true }),
    activateTmuxPane: async () => true,
    activateReadOnlyTmuxPane: async () => true,
    sessionPaneDeduplicator: deduplicator,
    log: () => undefined,
  } satisfies TmuxUtilDeps
  const manager = new TmuxSessionManager(context(), config, deps)
  const event = {
    type: "session.created",
    properties: { info: { id: "ses_shared", parentID: "ses_parent", title: "shared" } },
  }

  // when
  await manager.onSessionCreated(event)

  // then
  expect(dedupCalls).toBe(2)
  expect(executeActions).toHaveBeenCalledTimes(1)

  await manager.cleanup()
})

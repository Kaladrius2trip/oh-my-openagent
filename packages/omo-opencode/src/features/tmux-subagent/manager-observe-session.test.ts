import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TmuxConfig } from "../../config/schema"
import type { ExecuteActionsResult } from "./action-executor"
import type { TmuxUtilDeps } from "./manager"
import { TmuxSessionManager } from "./manager"
import { passthroughSessionPaneDeduplicator } from "./session-pane-deduplicator.test-support"
import type { TrackedSession, WindowState } from "./types"

const config: TmuxConfig = {
  enabled: true,
  isolation: "inline",
  layout: "main-vertical",
  main_pane_size: 60,
  main_pane_min_width: 80,
  agent_pane_min_width: 40,
}

function windowState(observePaneActive = false): WindowState {
  return {
    windowWidth: 220,
    windowHeight: 44,
    mainPane: { paneId: "%0", width: 110, height: 44, left: 0, top: 0, title: "main", isActive: true },
    agentPanes: [{
      paneId: "%observe",
      width: 110,
      height: 44,
      left: 110,
      top: 0,
      title: "MoA advisor",
      isActive: observePaneActive,
    }],
  }
}

function context(): PluginInput {
  return unsafeTestValue<PluginInput>({
    directory: "/tmp/project",
    serverUrl: new URL("http://127.0.0.1:4096"),
    client: {
      session: {
        status: async () => ({ data: { "session-1": { type: "running" } } }),
        messages: async () => ({ data: [] }),
      },
    },
  })
}

function successfulSpawn(): ExecuteActionsResult {
  return {
    success: true,
    spawnedPaneId: "%observe",
    results: [],
  }
}

function dependencies(overrides: Partial<TmuxUtilDeps> = {}): Partial<TmuxUtilDeps> {
  return {
    isInsideTmux: () => true,
    getCurrentPaneId: () => "%0",
    queryWindowState: async () => ({ kind: "ok", state: windowState() }),
    waitForSessionReady: async () => true,
    executeActions: async () => successfulSpawn(),
    executeAction: async () => ({ success: true }),
    activateTmuxPane: async () => true,
    activateReadOnlyTmuxPane: async () => true,
    sessionPaneDeduplicator: passthroughSessionPaneDeduplicator,
    log: () => undefined,
    ...overrides,
  }
}

function trackedSession(manager: TmuxSessionManager, sessionId: string): TrackedSession | undefined {
  const internals = unsafeTestValue<{ sessions: Map<string, TrackedSession> }>(manager)
  return internals.sessions.get(sessionId)
}

describe("TmuxSessionManager observeSession", () => {
  test("#given an observable MoA session #when its pane opens #then observe-only activation runs and interactive activation never runs", async () => {
    const interactiveActivator = mock(async () => true)
    const readOnlyActivator = mock(async () => true)
    const manager = new TmuxSessionManager(context(), config, dependencies({
      activateTmuxPane: interactiveActivator,
      activateReadOnlyTmuxPane: readOnlyActivator,
    }))

    await manager.observeSession("session-1", "MoA advisor: architect")

    expect(readOnlyActivator).toHaveBeenCalledTimes(1)
    expect(interactiveActivator).not.toHaveBeenCalled()
    expect(trackedSession(manager, "session-1")).toMatchObject({
      mode: "observe-only",
      attachActivated: true,
    })
    await manager.cleanup()
  })

  test("#given first observe-only activation fails #when polling retries an unfocused pane #then retry still uses only the read-only activator", async () => {
    const interactiveActivator = mock(async () => true)
    let activationCount = 0
    const readOnlyActivator = mock(async () => {
      activationCount += 1
      return activationCount > 1
    })
    const manager = new TmuxSessionManager(context(), config, dependencies({
      queryWindowState: async () => ({ kind: "ok", state: windowState(false) }),
      activateTmuxPane: interactiveActivator,
      activateReadOnlyTmuxPane: readOnlyActivator,
    }))

    await manager.observeSession("session-1", "MoA advisor: architect")
    const pollingManager = unsafeTestValue<{ pollSessions: () => Promise<void> }>(
      unsafeTestValue<{ pollingManager: unknown }>(manager).pollingManager,
    )
    await pollingManager.pollSessions()

    expect(readOnlyActivator).toHaveBeenCalledTimes(2)
    expect(interactiveActivator).not.toHaveBeenCalled()
    expect(trackedSession(manager, "session-1")?.attachActivated).toBe(true)
    await manager.cleanup()
  })

  test("#given observe-only placement is deferred #when capacity becomes available #then deferred tracking preserves observe-only activation", async () => {
    let queryCount = 0
    const readOnlyActivator = mock(async () => true)
    const manager = new TmuxSessionManager(context(), config, dependencies({
      queryWindowState: async () => {
        queryCount += 1
        return queryCount === 1
          ? { kind: "transient", detail: "test transient" }
          : { kind: "ok", state: windowState() }
      },
      activateReadOnlyTmuxPane: readOnlyActivator,
    }))

    await manager.observeSession("session-1", "MoA advisor: architect")
    const internals = unsafeTestValue<{
      deferredSessions: Map<string, { mode: string }>
      tryAttachDeferredSession: () => Promise<void>
    }>(manager)
    expect(internals.deferredSessions.get("session-1")?.mode).toBe("observe-only")

    await internals.tryAttachDeferredSession()

    expect(readOnlyActivator).toHaveBeenCalledTimes(1)
    expect(trackedSession(manager, "session-1")?.mode).toBe("observe-only")
    await manager.cleanup()
  })
})

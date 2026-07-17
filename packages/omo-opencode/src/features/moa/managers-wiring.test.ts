import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "../../config/schema/oh-my-opencode-config"
import { createManagers } from "../../create-managers"
import { createPluginDispose } from "../../plugin-dispose"
import { createModelCacheState } from "../../plugin-state"
import type { MoAManager } from "./moa-manager"

class FakeBackgroundManager {
  async shutdown(): Promise<void> {}
}

class FakeSkillMcpManager {
  async disconnectAll(): Promise<void> {}
}

class FakeTmuxSessionManager {
  async cleanup(): Promise<void> {}
  getTrackedPaneId(): undefined { return undefined }
}

function context(): PluginInput {
  const shell = Object.assign(() => Promise.resolve(), {
    braces: () => [], escape: (value: string) => value,
    env() { return shell }, cwd() { return shell }, nothrow() { return shell }, throws() { return shell },
  })
  return {
    project: { id: "project", worktree: "/tmp/project", time: { created: 1 } },
    directory: "/tmp/project",
    worktree: "/tmp/project",
    experimental_workspace: { register: () => {} },
    serverUrl: undefined,
    $: shell,
    client: {} as PluginInput["client"],
  }
}

function tmuxConfig() {
  return {
    enabled: false,
    layout: "main-vertical" as const,
    main_pane_size: 60,
    main_pane_min_width: 120,
    agent_pane_min_width: 40,
    isolation: "inline" as const,
  }
}

function createHarness(moaManager: MoAManager) {
  const factoryCalls: unknown[] = []
  const cleanupRegistrations: Array<{ shutdown: () => void | Promise<void> }> = []
  const managers = (enabled: boolean) => createManagers({
    ctx: context(),
    pluginConfig: OhMyOpenCodeConfigSchema.parse({
      moa: { enabled },
      tui: { sidebar: { enabled: false } },
    }),
    tmuxConfig: tmuxConfig(),
    modelCacheState: createModelCacheState(),
    backgroundNotificationHookEnabled: false,
    deps: {
      BackgroundManagerClass: FakeBackgroundManager as typeof import("../background-agent").BackgroundManager,
      SkillMcpManagerClass: FakeSkillMcpManager as typeof import("../skill-mcp-manager").SkillMcpManager,
      TmuxSessionManagerClass: FakeTmuxSessionManager as typeof import("../tmux-subagent").TmuxSessionManager,
      initTaskToastManagerFn: () => ({} as ReturnType<typeof import("../task-toast-manager").initTaskToastManager>),
      registerManagerForCleanupFn: (manager) => cleanupRegistrations.push(manager),
      cleanupSessionTeamRunsFn: async () => ({ cleanedTeamRunIds: [], removedLayoutTeamRunIds: [], errors: [] }),
      createConfigHandlerFn: () => async () => {},
      markServerRunningInProcessFn: () => {},
      createMoAManagerFn: (options) => {
        factoryCalls.push(options)
        return moaManager
      },
    },
  })
  return { managers, factoryCalls, cleanupRegistrations }
}

describe("MoA manager wiring", () => {
  test("#given MoA is disabled #when managers are created #then MoAManager stays absent", () => {
    // given
    const moaManager: MoAManager = {
      run: async () => ({ runId: "unused", status: "failed", advisorResults: [] }),
      cancel: async () => false,
      getRun: () => undefined,
      shutdown: async () => {},
    }
    const harness = createHarness(moaManager)

    // when
    const managers = harness.managers(false)

    // then
    expect(managers.moaManager).toBeUndefined()
    expect(harness.factoryCalls).toHaveLength(0)
  })

  test("#given MoA is enabled #when managers are created and plugin disposes #then MoAManager is registered and shutdown is awaited", async () => {
    // given
    let releaseShutdown: (() => void) | undefined
    let shutdownFinished = false
    const shutdownGate = new Promise<void>((resolve) => { releaseShutdown = resolve })
    const moaManager: MoAManager = {
      run: async () => ({ runId: "unused", status: "failed", advisorResults: [] }),
      cancel: async () => false,
      getRun: () => undefined,
      shutdown: async () => {
        await shutdownGate
        shutdownFinished = true
      },
    }
    const harness = createHarness(moaManager)
    const managers = harness.managers(true)
    const dispose = createPluginDispose({
      backgroundManager: managers.backgroundManager,
      moaManager: managers.moaManager,
      skillMcpManager: managers.skillMcpManager,
      disposeHooks: () => {},
    })

    // when
    const disposePromise = dispose()
    await Promise.resolve()

    // then
    expect(managers.moaManager).toBe(moaManager)
    expect(harness.factoryCalls).toHaveLength(1)
    expect(harness.cleanupRegistrations).toContain(moaManager)
    expect(shutdownFinished).toBe(false)
    releaseShutdown?.()
    await disposePromise
    expect(shutdownFinished).toBe(true)
  })
})

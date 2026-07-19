import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "../../config/schema/oh-my-opencode-config"
import { createManagers } from "../../create-managers"
import { createPluginDispose } from "../../plugin-dispose"
import { createModelCacheState } from "../../plugin-state"
import type { MoAChildLaunchInput, ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import type { BackgroundTask, LaunchInput } from "../background-agent"
import { createMoAManager, type MoAManager } from "./moa-manager"

const observedSessions: Array<{ sessionId: string; title: string }> = []
const closedSessions: string[] = []
const moaLaunchInputs: LaunchInput[] = []
const fakeTasks = new Map<string, Partial<BackgroundTask> & Pick<BackgroundTask, "id" | "status">>()

class FakeBackgroundManager {
  async launch(input: LaunchInput): Promise<Pick<BackgroundTask, "id" | "sessionId">> {
    const index = moaLaunchInputs.length + 1
    const taskId = `bg-${index}`
    const sessionId = `session-${index}`
    moaLaunchInputs.push(input)
    await input.onSessionCreated?.(sessionId)
    fakeTasks.set(taskId, { id: taskId, status: "completed", model: input.model })
    return { id: taskId, sessionId }
  }

  getTask(taskId: string): Partial<BackgroundTask> & Pick<BackgroundTask, "id" | "status"> | undefined {
    return fakeTasks.get(taskId)
  }

  getTaskLastActivityAt(): undefined { return undefined }
  async readTaskOutput() { return { status: "resolved", output: "done" } as const }
  async cancelTask(): Promise<boolean> { return true }
  async shutdown(): Promise<void> {}
}

class FakeSkillMcpManager {
  async disconnectAll(): Promise<void> {}
}

class FakeTmuxSessionManager {
  async observeSession(sessionId: string, title: string): Promise<void> {
    observedSessions.push({ sessionId, title })
  }
  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    closedSessions.push(event.sessionID)
  }
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

function tmuxConfig(enabled = false) {
  return {
    enabled,
    layout: "main-vertical" as const,
    main_pane_size: 60,
    main_pane_min_width: 120,
    agent_pane_min_width: 40,
    isolation: "inline" as const,
  }
}

function createHarness(moaManager: MoAManager) {
  observedSessions.length = 0
  closedSessions.length = 0
  moaLaunchInputs.length = 0
  fakeTasks.clear()
  const factoryCalls: Array<Parameters<typeof createMoAManager>[0]> = []
  const cleanupRegistrations: Array<{ shutdown: () => void | Promise<void> }> = []
  const managers = (enabled: boolean, tmuxVisualization = false, tmuxEnabled = false) => createManagers({
    ctx: context(),
    pluginConfig: OhMyOpenCodeConfigSchema.parse({
      moa: { enabled, tmux_visualization: tmuxVisualization },
      tui: { sidebar: { enabled: false } },
    }),
    tmuxConfig: tmuxConfig(tmuxEnabled),
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

const resolvedTarget: ResolvedMoATarget = {
  requested: { category: "moa-architect" },
  agent: "sisyphus-junior",
  category: "moa-architect",
  model: { providerID: "openai", modelID: "gpt-5.5" },
  fallbackChain: [],
}

function childInput(role: "advisor" | "aggregator", slot?: string): MoAChildLaunchInput {
  return {
    role,
    target: resolvedTarget,
    prompt: `${role} prompt`,
    visibility: "internal",
    notificationPolicy: "manual",
    suppressTmuxSpawn: true,
    toolPolicy: "none",
    capabilityProfile: "moa-consultation-only",
    continuationPolicy: "forbid",
    orchestration: { kind: "moa", runId: "run-1", role, ...(slot !== undefined ? { slot } : {}) },
  }
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

  test.each([
    ["visualization defaults off", false, true],
    ["tmux is unavailable", true, false],
  ] as const)("#given %s #when a MoA advisor launches #then no observer callback is installed", async (
    _caseName,
    tmuxVisualization,
    tmuxEnabled,
  ) => {
    const moaManager: MoAManager = {
      run: async () => ({ runId: "unused", status: "failed", advisorResults: [] }),
      cancel: async () => false,
      getRun: () => undefined,
      shutdown: async () => {},
    }
    const harness = createHarness(moaManager)
    harness.managers(true, tmuxVisualization, tmuxEnabled)
    const factoryOptions = harness.factoryCalls[0]
    if (factoryOptions === undefined) throw new Error("MoA manager factory was not called")
    const adapter = factoryOptions.createAdapter({ sessionID: "parent", messageID: "message" })

    await adapter.launchChild(childInput("advisor", "architect"))

    expect(moaLaunchInputs[0]?.onSessionCreated).toBeUndefined()
    expect(observedSessions).toEqual([])
  })

  test("#given visualization and tmux are enabled #when advisor and aggregator finish #then both observer panes open and close", async () => {
    const moaManager: MoAManager = {
      run: async () => ({ runId: "unused", status: "failed", advisorResults: [] }),
      cancel: async () => false,
      getRun: () => undefined,
      shutdown: async () => {},
    }
    const harness = createHarness(moaManager)
    harness.managers(true, true, true)
    const factoryOptions = harness.factoryCalls[0]
    if (factoryOptions === undefined) throw new Error("MoA manager factory was not called")
    const adapter = factoryOptions.createAdapter({ sessionID: "parent", messageID: "message" })

    const advisor = await adapter.launchChild(childInput("advisor", "architect"))
    const aggregator = await adapter.launchChild(childInput("aggregator"))
    await adapter.waitForChild(advisor, { baseMs: 100, idleWindowMs: 60, maxWallMs: 400 }, new AbortController().signal)
    await adapter.waitForChild(aggregator, { baseMs: 100, idleWindowMs: 60, maxWallMs: 400 }, new AbortController().signal)

    expect(observedSessions).toEqual([
      { sessionId: "session-1", title: "MoA advisor: architect" },
      { sessionId: "session-2", title: "MoA aggregator: synthesis" },
    ])
    expect(closedSessions).toEqual(["session-1", "session-2"])
  })
})

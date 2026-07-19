/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type {
  MoAAdvisorChildLaunchInput,
  MoAAggregatorChildLaunchInput,
  MoAChildLaunchInput,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"
import type { BackgroundTask, BackgroundTaskStatus, LaunchInput } from "../background-agent"

import { createMoAExecutionAdapter } from "./moa-execution-adapter"

const target: ResolvedMoATarget = {
  requested: { category: "moa-architect" },
  agent: "sisyphus-junior",
  category: "moa-architect",
  model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
  fallbackChain: [{ providerID: "openai", modelID: "gpt-5.5", reasoningEffort: "high" }],
}

function childInput(role: "advisor", slot?: string): MoAAdvisorChildLaunchInput
function childInput(role: "aggregator"): MoAAggregatorChildLaunchInput
function childInput(role: "advisor" | "aggregator", slot?: string): MoAChildLaunchInput {
  const base = {
    target,
    prompt: `${role} prompt`,
    visibility: "internal",
    notificationPolicy: "manual",
    suppressTmuxSpawn: true,
    toolPolicy: "none",
    capabilityProfile: "moa-consultation-only",
    continuationPolicy: "forbid",
  } as const
  if (role === "advisor") {
    return {
      ...base,
      role,
      orchestration: { kind: "moa", runId: "run-1", role, ...(slot !== undefined ? { slot } : {}) },
    }
  }
  return { ...base, role, orchestration: { kind: "moa", runId: "run-1", role } }
}

function task(taskId: string, status: BackgroundTaskStatus): Partial<BackgroundTask> & Pick<BackgroundTask, "id" | "status"> {
  return { id: taskId, status, model: target.model }
}

describe("createMoAExecutionAdapter observe-only sessions", () => {
  test("#given visualization is absent #when an advisor launches #then the existing launch shape has no session observer callback", async () => {
    const launches: LaunchInput[] = []
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          launches.push(input)
          return { id: "bg-1", sessionId: "session-1" }
        },
        getTask: () => task("bg-1", "completed"),
    getTaskLiveness: async () => ({ kind: "starting" as const }),
        readTaskOutput: async () => ({ status: "resolved", output: "report" }),
        cancelTask: async () => true,
      },
      parent: {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      },
      resolveTarget: async () => target,
    })

    await adapter.launchChild(childInput("advisor", "architect"))

    expect(launches).toEqual([{
      description: "MoA advisor: architect",
      prompt: "advisor prompt",
      agent: "sisyphus-junior",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      parentAgent: "sisyphus",
      parentModel: { providerID: "openai", modelID: "gpt-5.6-sol" },
      model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
      fallbackChain: [{ providers: ["openai"], model: "gpt-5.5", reasoningEffort: "high" }],
      category: "moa-architect",
      visibility: "internal",
      notificationPolicy: "manual",
      suppressTmuxSpawn: true,
      toolPolicy: "none",
      capabilityProfile: "moa-consultation-only",
      continuationPolicy: "forbid",
      orchestration: { kind: "moa", runId: "run-1", role: "advisor", slot: "architect" },
    }])
    expect(launches[0]?.onSessionCreated).toBeUndefined()
  })

  test("#given visualization is enabled #when advisor and aggregator sessions launch #then both open while all six controls stay pinned", async () => {
    const events: string[] = []
    const launches: LaunchInput[] = []
    let taskCount = 0
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          launches.push(input)
          taskCount += 1
          await input.onSessionCreated?.(`session-${taskCount}`)
          return { id: `bg-${taskCount}`, sessionId: `session-${taskCount}` }
        },
        getTask: (taskId) => task(taskId, "completed"),
    getTaskLiveness: async () => ({ kind: "starting" as const }),
        readTaskOutput: async () => ({ status: "resolved", output: "report" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      sessionObserver: {
        openSession: async (sessionId, title) => { events.push(`open:${sessionId}:${title}`) },
        closeSession: async (sessionId) => { events.push(`close:${sessionId}`) },
      },
    })

    await adapter.launchChild(childInput("advisor", "architect"))
    await adapter.launchChild(childInput("aggregator"))

    expect(events).toEqual([
      "open:session-1:MoA advisor: architect",
      "open:session-2:MoA aggregator: synthesis",
    ])
    expect(launches.every((launch) => (
      launch.visibility === "internal"
      && launch.notificationPolicy === "manual"
      && launch.suppressTmuxSpawn === true
      && launch.toolPolicy === "none"
      && launch.capabilityProfile === "moa-consultation-only"
      && launch.continuationPolicy === "forbid"
    ))).toBe(true)
  })

  test("#given a fallback retry #when its replacement session arrives #then the old observe session closes before the replacement opens", async () => {
    const events: string[] = []
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          await input.onSessionCreated?.("session-old")
          await input.onSessionCreated?.("session-new")
          return { id: "bg-1", sessionId: "session-new" }
        },
        getTask: () => task("bg-1", "completed"),
    getTaskLiveness: async () => ({ kind: "starting" as const }),
        readTaskOutput: async () => ({ status: "resolved", output: "report" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      sessionObserver: {
        openSession: async (sessionId) => { events.push(`open:${sessionId}`) },
        closeSession: async (sessionId) => { events.push(`close:${sessionId}`) },
      },
    })

    const handle = await adapter.launchChild(childInput("advisor", "architect"))
    await adapter.waitForChild(handle, { baseMs: 100, idleWindowMs: 60, maxWallMs: 400 }, new AbortController().signal)

    expect(events).toEqual([
      "open:session-old",
      "close:session-old",
      "open:session-new",
      "close:session-new",
    ])
  })

  test.each([
    ["completion", "completed", false, 100, "completed"],
    ["failure", "error", false, 100, "failed"],
    ["timeout", "running", false, 1, "timed_out"],
    ["cancel", "running", true, 100, "cancelled"],
  ] as const)("#given %s #when the child wait terminates #then its pane closes exactly once", async (
    _caseName,
    backgroundStatus,
    aborted,
    timeoutMs,
    expectedStatus,
  ) => {
    const closes: string[] = []
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          await input.onSessionCreated?.("session-1")
          return { id: "bg-1", sessionId: "session-1" }
        },
        getTask: () => task("bg-1", backgroundStatus),
    getTaskLiveness: async () => ({ kind: "starting" as const }),
        readTaskOutput: async () => ({ status: "resolved", output: "report" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      pollIntervalMs: 1,
      sessionObserver: {
        openSession: async () => {},
        closeSession: async (sessionId) => { closes.push(sessionId) },
      },
    })
    const handle = await adapter.launchChild(childInput("advisor", "architect"))
    const controller = new AbortController()
    if (aborted) controller.abort("cancelled")

    const result = await adapter.waitForChild(
      handle,
      { baseMs: timeoutMs, idleWindowMs: 60, maxWallMs: timeoutMs * 4 },
      controller.signal,
    )

    expect(result.status).toBe(expectedStatus)
    expect(closes).toEqual(["session-1"])
  })

  test("#given shutdown cancellation and a late retry callback #when both arrive #then the pane closes once and cannot reopen", async () => {
    const events: string[] = []
    let onSessionCreated: LaunchInput["onSessionCreated"]
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          onSessionCreated = input.onSessionCreated
          await onSessionCreated?.("session-1")
          return { id: "bg-1", sessionId: "session-1" }
        },
        getTask: () => task("bg-1", "cancelled"),
    getTaskLiveness: async () => ({ kind: "starting" as const }),
        readTaskOutput: async () => ({ status: "failed", reason: "task_missing" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      sessionObserver: {
        openSession: async (sessionId) => { events.push(`open:${sessionId}`) },
        closeSession: async (sessionId) => { events.push(`close:${sessionId}`) },
      },
    })
    const handle = await adapter.launchChild(childInput("advisor", "architect"))

    await adapter.cancelChild(handle, "MoA manager shutdown")
    await adapter.waitForChild(handle, { baseMs: 100, idleWindowMs: 60, maxWallMs: 400 }, new AbortController().signal)
    const lateSessionCallback = onSessionCreated
    if (lateSessionCallback !== undefined) {
      await Promise.resolve(lateSessionCallback("session-late"))
    }

    expect(events).toEqual(["open:session-1", "close:session-1"])
  })

  test("#given launch fails after session creation #when the error propagates #then the opened pane still closes", async () => {
    const closes: string[] = []
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          await input.onSessionCreated?.("session-1")
          throw new Error("launch failed")
        },
        getTask: () => undefined,
    getTaskLiveness: async () => ({ kind: "starting" as const }),
        readTaskOutput: async () => ({ status: "failed", reason: "task_missing" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      sessionObserver: {
        openSession: async () => {},
        closeSession: async (sessionId) => { closes.push(sessionId) },
      },
    })

    let launchError: unknown
    try {
      await adapter.launchChild(childInput("advisor", "architect"))
    } catch (error) {
      if (error instanceof Error) launchError = error
      else throw error
    }

    expect(launchError).toBeInstanceOf(Error)
    expect(launchError instanceof Error ? launchError.message : undefined).toBe("launch failed")
    expect(closes).toEqual(["session-1"])
  })
})

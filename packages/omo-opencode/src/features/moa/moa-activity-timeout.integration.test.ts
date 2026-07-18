/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { MoAChildLaunchInput, ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager, waitForTaskSessionID } from "../background-agent"
import { createMoAExecutionAdapter } from "./moa-execution-adapter"

const target: ResolvedMoATarget = {
  requested: { category: "moa-architect" },
  agent: "sisyphus-junior",
  category: "moa-architect",
  model: { providerID: "openai", modelID: "gpt-5.4-mini" },
  fallbackChain: [],
}

const advisorInput: MoAChildLaunchInput = {
  role: "advisor",
  target,
  prompt: "Review timeout behavior",
  visibility: "internal",
  notificationPolicy: "manual",
  suppressTmuxSpawn: true,
  toolPolicy: "none",
  capabilityProfile: "moa-consultation-only",
  continuationPolicy: "forbid",
  orchestration: { kind: "moa", runId: "run-activity", role: "advisor", slot: "architect" },
}

function createHarness(): {
  readonly manager: BackgroundManager
  readonly adapter: ReturnType<typeof createMoAExecutionAdapter>
} {
  let promptDispatched = false
  const client = {
    session: {
      get: async () => ({ data: { id: "parent-session", directory: "/tmp/moa-activity-integration" } }),
      create: async () => ({ data: { id: "child-session" } }),
      promptAsync: async () => {
        promptDispatched = true
        return { data: {} }
      },
      messages: async () => ({
        data: promptDispatched ? [{
          info: { role: "assistant" },
          parts: [{ type: "text", text: "complete synthesis input" }],
        }] : [],
      }),
      todo: async () => ({ data: [] }),
      abort: async () => ({ data: true }),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({ client, directory: "/tmp/moa-activity-integration" }),
    enableParentSessionNotifications: false,
  })
  return {
    manager,
    adapter: createMoAExecutionAdapter({
      backgroundManager: manager,
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      pollIntervalMs: 2,
    }),
  }
}

describe("MoA activity timeout with real BackgroundManager", () => {
  test("#given child emits parts past base deadline #when it later completes #then adapter returns completed synthesis input", async () => {
    // given
    const { manager, adapter } = createHarness()
    let activityTimer: ReturnType<typeof setInterval> | undefined
    let completionTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const handle = await adapter.launchChild(advisorInput)
      await waitForTaskSessionID(manager, handle.taskId, { timeoutMs: 1_000, intervalMs: 1 })
      const task = manager.getTask(handle.taskId)
      if (task === undefined || task.sessionId === undefined) throw new Error("MoA child did not start")
      task.startedAt = new Date(Date.now() - 10_000)
      activityTimer = setInterval(() => {
        manager.handleEvent({
          type: "session.next.text.delta",
          properties: { sessionID: task.sessionId, timestamp: Date.now(), delta: "streaming" },
        })
      }, 10)
      completionTimer = setTimeout(() => {
        if (activityTimer !== undefined) clearInterval(activityTimer)
        manager.handleEvent({ type: "session.idle", properties: { sessionID: task.sessionId } })
      }, 90)

      // when
      const result = await adapter.waitForChild(handle, {
        baseMs: 40,
        idleWindowMs: 30,
        maxWallMs: 200,
      }, new AbortController().signal)

      // then
      expect(result.status).toBe("completed")
      expect(result.output).toBe("complete synthesis input")
    } finally {
      if (activityTimer !== undefined) clearInterval(activityTimer)
      if (completionTimer !== undefined) clearTimeout(completionTimer)
      await manager.shutdown()
    }
  })

  test("#given child emits no parts #when base deadline arrives #then adapter times out without liveness grace", async () => {
    // given
    const { manager, adapter } = createHarness()
    try {
      const handle = await adapter.launchChild(advisorInput)
      await waitForTaskSessionID(manager, handle.taskId, { timeoutMs: 1_000, intervalMs: 1 })
      const startedAt = Date.now()

      // when
      const result = await adapter.waitForChild(handle, {
        baseMs: 40,
        idleWindowMs: 30,
        maxWallMs: 200,
      }, new AbortController().signal)
      const elapsed = Date.now() - startedAt

      // then
      expect(result.status).toBe("timed_out")
      expect(elapsed).toBeGreaterThanOrEqual(35)
      expect(elapsed).toBeLessThan(100)
    } finally {
      await manager.shutdown()
    }
  })
})

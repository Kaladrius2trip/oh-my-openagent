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

function advisorInput(): MoAChildLaunchInput {
  return {
    role: "advisor",
    target,
    prompt: "Review output transport",
    visibility: "internal",
    notificationPolicy: "manual",
    suppressTmuxSpawn: true,
    toolPolicy: "none",
    capabilityProfile: "moa-consultation-only",
    continuationPolicy: "forbid",
    orchestration: { kind: "moa", runId: "run-output", role: "advisor", slot: "architect" },
  }
}

describe("MoA execution adapter with BackgroundManager", () => {
  test("#given completed session text #when child settles #then adapter reads output without populating task result", async () => {
    // given
    const assistantText = "Advisor report from the child session"
    let childPromptDispatched = false
    const client = {
      session: {
        get: async () => ({ data: { id: "parent-session", directory: "/tmp" } }),
        create: async () => ({ data: { id: "child-session" } }),
        promptAsync: async () => {
          childPromptDispatched = true
          return { data: {} }
        },
        messages: async () => ({
          data: childPromptDispatched ? [{
            info: { role: "assistant" },
            parts: [{ type: "text", text: assistantText }],
          }] : [],
        }),
        todo: async () => ({ data: [] }),
        abort: async () => ({ data: true }),
      },
    }
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client, directory: "/tmp" }),
      enableParentSessionNotifications: false,
    })
    const adapter = createMoAExecutionAdapter({
      backgroundManager: manager,
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      pollIntervalMs: 1,
    })

    try {
      const handle = await adapter.launchChild(advisorInput())
      await waitForTaskSessionID(manager, handle.taskId, { timeoutMs: 1_000, intervalMs: 1 })
      const task = manager.getTask(handle.taskId)
      if (task === undefined || task.sessionId === undefined) {
        throw new Error("MoA child did not start")
      }
      task.startedAt = new Date(Date.now() - 10_000)

      // when
      manager.handleEvent({ type: "session.idle", properties: { sessionID: task.sessionId } })
      const result = await adapter.waitForChild(handle, 1_000, new AbortController().signal)

      // then
      expect(manager.getTask(handle.taskId)?.result).toBeUndefined()
      expect(result.status).toBe("completed")
      expect(result.output).toBe(assistantText)
    } finally {
      await manager.shutdown()
    }
  })
})

import { afterEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const managers: BackgroundManager[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()))
})

describe("BackgroundManager.readTaskOutput", () => {
  test("#given current retry session text #when task output is read #then only that session is queried without prompt dispatch", async () => {
    // given
    const messageReads = mock(async () => ({
      data: [{
        info: { role: "assistant" },
        parts: [{ type: "text", text: "current attempt report" }],
      }],
    }))
    const promptDispatches = mock(async () => ({ data: {} }))
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({
        client: { session: { messages: messageReads, promptAsync: promptDispatches } },
        directory: "/tmp/moa-output",
      }),
    })
    managers.push(manager)
    const task: BackgroundTask = {
      id: "bg-output",
      sessionId: "current-session",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      description: "MoA advisor",
      prompt: "Review",
      agent: "sisyphus-junior",
      status: "completed",
      visibility: "internal",
      attempts: [
        { attemptId: "attempt-1", attemptNumber: 1, sessionId: "stale-session", status: "error" },
        { attemptId: "attempt-2", attemptNumber: 2, sessionId: "current-session", status: "completed" },
      ],
      currentAttemptID: "attempt-2",
    }
    unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(manager).tasks.set(task.id, task)

    // when
    const result = await manager.readTaskOutput(task.id)

    // then
    expect(result).toEqual({ status: "resolved", output: "current attempt report" })
    expect(messageReads).toHaveBeenCalledWith({
      path: { id: "current-session" },
      query: { directory: "/tmp/moa-output" },
    })
    expect(promptDispatches).not.toHaveBeenCalled()
    expect(task.result).toBeUndefined()
  })
})

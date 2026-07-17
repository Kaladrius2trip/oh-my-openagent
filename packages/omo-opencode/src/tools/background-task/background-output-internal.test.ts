import { describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

function createInternalTask(): BackgroundTask {
  return {
    id: "bg-internal-output",
    sessionId: "session-internal-output",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "Private advisor result",
    prompt: "SECRET_PROMPT",
    result: "SECRET_RESULT",
    agent: "oracle",
    status: "completed",
    visibility: "internal",
  }
}

describe("background_output internal task boundary", () => {
  test("given an internal task when output is requested then it denies before metadata or result reads", async () => {
    const task = createInternalTask()
    const messageReads = mock(async () => ({
      data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "SECRET_RESULT" }] }],
    }))
    const manager: BackgroundOutputManager = {
      getTask: (taskID) => taskID === task.id ? task : undefined,
    }
    const client: BackgroundOutputClient = { session: { messages: messageReads } }
    const metadata = mock(() => {})
    const tool = createBackgroundOutput(manager, client)

    const output = await tool.execute(
      { task_id: task.id, full_session: true },
      unsafeTestValue<ToolContext>({
        sessionID: "external-session",
        messageID: "external-message",
        metadata,
      }),
    )

    expect(output).toContain("task is internal")
    expect(output).not.toContain("SECRET")
    expect(messageReads).not.toHaveBeenCalled()
    expect(metadata).not.toHaveBeenCalled()
  })
})

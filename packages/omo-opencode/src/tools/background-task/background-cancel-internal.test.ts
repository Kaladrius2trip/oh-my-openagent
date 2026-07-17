import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import type { BackgroundCancelClient } from "./clients"
import { createBackgroundCancel } from "./create-background-cancel"

function createTask(id: string, visibility?: "normal" | "internal"): BackgroundTask {
  return {
    id,
    sessionId: `session-${id}`,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: `${id} description`,
    prompt: "Review",
    agent: "oracle",
    status: "running",
    visibility,
  }
}

const toolContext = unsafeTestValue<ToolContext>({ sessionID: "parent-session" })
const client: BackgroundCancelClient = { session: { abort: async () => ({ data: true }) } }

describe("background_cancel internal task boundary", () => {
  test("given normal and internal descendants when all are cancelled then both stop but only normal is enumerated", async () => {
    const normal = createTask("bg-normal", "normal")
    const internal = createTask("bg-internal", "internal")
    const manager = unsafeTestValue<BackgroundManager>({
      getAllDescendantTasks: () => [normal, internal],
      cancelTask: async (taskID: string) => {
        const task = taskID === normal.id ? normal : internal
        task.status = "cancelled"
        return true
      },
    })
    const tool = createBackgroundCancel(manager, client)

    const output = await tool.execute({ all: true }, toolContext)

    expect(normal.status).toBe("cancelled")
    expect(internal.status).toBe("cancelled")
    expect(output).toContain("Cancelled 1 background task(s)")
    expect(output).toContain(normal.id)
    expect(output).not.toContain(internal.id)
    expect(output).not.toContain(internal.description)
  })

  test("given an internal task id when directly cancelled then it is denied without mutation", async () => {
    const internal = createTask("bg-internal-direct", "internal")
    let cancelCalls = 0
    const manager = unsafeTestValue<BackgroundManager>({
      getTask: () => internal,
      cancelTask: async () => { cancelCalls += 1; internal.status = "cancelled"; return true },
    })
    const tool = createBackgroundCancel(manager, client)

    const output = await tool.execute({ taskId: internal.id }, toolContext)

    expect(output).toContain("task is internal")
    expect(cancelCalls).toBe(0)
    expect(internal.status).toBe("running")
  })

  test("given a normal task id when directly cancelled then existing success behavior remains", async () => {
    const normal = createTask("bg-normal-direct", "normal")
    const manager = unsafeTestValue<BackgroundManager>({
      getTask: () => normal,
      cancelTask: async () => { normal.status = "cancelled"; return true },
    })
    const tool = createBackgroundCancel(manager, client)

    const output = await tool.execute({ taskId: normal.id }, toolContext)

    expect(output).toContain("Task cancelled successfully")
  })
})

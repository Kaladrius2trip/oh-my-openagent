import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask, BackgroundTaskStatus } from "./types"

function createTask(status: BackgroundTaskStatus = "running", sessionId = "session-1"): BackgroundTask {
  return {
    id: "task-1",
    sessionId,
    parentSessionId: "parent-1",
    parentMessageId: "message-1",
    description: "test task",
    prompt: "test prompt",
    agent: "test-agent",
    status,
    startedAt: new Date(),
  }
}

function createManager(status: () => Promise<unknown>): BackgroundManager {
  const client = {
    session: {
      status,
      abort: async () => ({ data: true }),
    },
  }
  return new BackgroundManager({
    pluginContext: { client, directory: "/tmp" } as unknown as PluginInput,
    enableParentSessionNotifications: false,
  })
}

function setTask(manager: BackgroundManager, task: BackgroundTask): void {
  const state = manager as unknown as { tasks: Map<string, BackgroundTask> }
  state.tasks.set(task.id, task)
}

describe("BackgroundManager.getTaskLiveness", () => {
  let manager: BackgroundManager | undefined

  afterEach(async () => {
    await manager?.shutdown()
    manager = undefined
  })

  test("#given terminal task statuses #when liveness is checked #then status read is skipped", async () => {
    let statusReads = 0
    manager = createManager(async () => {
      statusReads += 1
      return { data: {} }
    })

    for (const status of ["completed", "error", "cancelled", "interrupt"] as const) {
      setTask(manager, createTask(status))
      expect(await manager.getTaskLiveness("task-1")).toEqual({ kind: "terminal", status })
    }
    expect(statusReads).toBe(0)
  })

  test("#given pending tasks or tasks without sessions #when liveness is checked #then they are starting", async () => {
    manager = createManager(async () => ({ data: {} }))
    setTask(manager, createTask("pending"))

    expect(await manager.getTaskLiveness("task-1")).toEqual({ kind: "starting" })

    setTask(manager, { ...createTask("running"), sessionId: undefined })
    expect(await manager.getTaskLiveness("task-1")).toEqual({ kind: "starting" })
  })

  test("#given busy retry or running session status #when liveness is checked #then runner is active", async () => {
    let sessionStatus: "busy" | "retry" | "running" = "busy"
    manager = createManager(async () => ({ data: { "session-1": { type: sessionStatus } } }))
    setTask(manager, createTask())

    for (const status of ["busy", "retry", "running"] as const) {
      sessionStatus = status
      expect(await manager.getTaskLiveness("task-1")).toEqual({
        kind: "active",
        sessionID: "session-1",
        status,
      })
    }
  })

  test("#given successful idle or absent status #when liveness is checked #then task is quiescent", async () => {
    let statuses: Record<string, { type: string }> = { "session-1": { type: "idle" } }
    manager = createManager(async () => ({ data: statuses }))
    setTask(manager, createTask())

    expect(await manager.getTaskLiveness("task-1")).toEqual({
      kind: "quiescent",
      sessionID: "session-1",
    })

    statuses = {}
    expect(await manager.getTaskLiveness("task-1")).toEqual({
      kind: "quiescent",
      sessionID: "session-1",
    })
  })

  test("#given missing malformed unavailable or failed status reads #when liveness is checked #then result fails closed", async () => {
    manager = createManager(async () => {
      throw new Error("status unavailable")
    })
    setTask(manager, createTask())

    expect(await manager.getTaskLiveness("missing-task")).toMatchObject({ kind: "unknown" })
    expect(await manager.getTaskLiveness("task-1")).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("status unavailable"),
    })

    await manager.shutdown()
    manager = createManager(async () => ({ data: [] }))
    setTask(manager, createTask())
    expect(await manager.getTaskLiveness("task-1")).toMatchObject({ kind: "unknown" })

    await manager.shutdown()
    const client = { session: { abort: async () => ({ data: true }) } }
    manager = new BackgroundManager({
      pluginContext: { client, directory: "/tmp" } as unknown as PluginInput,
      enableParentSessionNotifications: false,
    })
    setTask(manager, createTask())
    expect(await manager.getTaskLiveness("task-1")).toMatchObject({ kind: "unknown" })
  })
})

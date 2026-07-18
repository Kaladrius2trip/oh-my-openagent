import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const managers: BackgroundManager[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()))
})

function createManager(): BackgroundManager {
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({
      client: {
        session: {
          abort: async () => ({ data: true }),
        },
      },
      directory: "/tmp/moa-activity",
    }),
    enableParentSessionNotifications: false,
  })
  managers.push(manager)
  return manager
}

function createRunningTask(): BackgroundTask {
  return {
    id: "bg-activity",
    sessionId: "session-old",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "MoA advisor",
    prompt: "Review",
    agent: "sisyphus-junior",
    status: "running",
    startedAt: new Date(),
    attempts: [{
      attemptId: "attempt-old",
      attemptNumber: 1,
      sessionId: "session-old",
      status: "running",
    }],
    currentAttemptID: "attempt-old",
  }
}

function addTask(manager: BackgroundManager, task: BackgroundTask): void {
  unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(manager).tasks.set(task.id, task)
}

describe("BackgroundManager.getTaskLastActivityAt", () => {
  test("#given an unknown task #when activity is read #then no timestamp is returned", () => {
    // given
    const manager = createManager()

    // when
    const result = manager.getTaskLastActivityAt("missing-task")

    // then
    expect(result).toBeUndefined()
  })

  test("#given the child prompt enters the current session #when activity is read #then prompt input is not treated as output activity", () => {
    // given
    const manager = createManager()
    const task = createRunningTask()
    addTask(manager, task)

    // when
    manager.handleEvent({
      type: "message.part.updated",
      properties: {
        sessionID: "session-old",
        part: {
          sessionID: "session-old",
          role: "user",
          type: "text",
          timestamp: 500,
          text: "Review",
        },
      },
    })

    // then
    expect(manager.getTaskLastActivityAt(task.id)).toBeUndefined()
  })

  test("#given a fallback swaps the current session #when both sessions emit stream parts #then only current session activity is returned", () => {
    // given
    const manager = createManager()
    const task = createRunningTask()
    addTask(manager, task)
    manager.handleEvent({
      type: "session.next.text.delta",
      properties: { sessionID: "session-old", timestamp: 1_000, delta: "old output" },
    })
    task.attempts = [
      { ...task.attempts?.[0], attemptId: "attempt-old", attemptNumber: 1, sessionId: "session-old", status: "error" },
      { attemptId: "attempt-current", attemptNumber: 2, sessionId: "session-current", status: "running" },
    ]
    task.currentAttemptID = "attempt-current"
    task.sessionId = "session-current"
    manager.handleEvent({
      type: "session.next.text.delta",
      properties: { sessionID: "session-old", timestamp: 3_000, delta: "stale output" },
    })

    // when
    manager.handleEvent({
      type: "session.next.text.delta",
      properties: { sessionID: "session-current", timestamp: 2_000, delta: "current output" },
    })
    const result = manager.getTaskLastActivityAt(task.id)

    // then
    expect(result).toBe(2_000)
  })

  test("#given recorded current-session activity #when task becomes terminal #then its activity entry is removed", async () => {
    // given
    const manager = createManager()
    const task = createRunningTask()
    addTask(manager, task)
    manager.handleEvent({
      type: "session.next.reasoning.delta",
      properties: { sessionID: "session-old", timestamp: 4_000, delta: "thinking" },
    })

    // when
    await manager.cancelTask(task.id, { source: "test", skipNotification: true })

    // then
    expect(manager.getTaskLastActivityAt(task.id)).toBeUndefined()
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

let manager: BackgroundManager | undefined

afterEach(() => {
  manager?.shutdown()
  manager = undefined
})

function createTask(id: string, visibility?: "normal" | "internal"): BackgroundTask {
  return {
    id,
    sessionId: `session-${id}`,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: id,
    prompt: "Review",
    agent: "oracle",
    status: "running",
    visibility,
  }
}

function createManager(tasks: readonly BackgroundTask[]): BackgroundManager {
  const created = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({
      client: { session: {} },
      directory: tmpdir(),
    }),
  })
  const taskMap = unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(created).tasks
  for (const task of tasks) taskMap.set(task.id, task)
  manager = created
  return created
}

describe("BackgroundManager internal child queries", () => {
  test("given only an active internal child when parent queries run then default hold ignores it and explicit access includes it", () => {
    // given
    const internal = createTask("internal", "internal")
    const created = createManager([internal])

    // when
    const visibleChildren = created.getTasksByParentSession("parent-session")
    const allChildren = created.getTasksByParentSession("parent-session", { includeInternal: true })

    // then
    expect(visibleChildren).toEqual([])
    expect(created.hasActiveChildTasks("parent-session")).toBe(false)
    expect(allChildren).toEqual([internal])
    expect(created.getAllDescendantTasks("parent-session")).toEqual([internal])
  })

  test("given a normal active child when parent queries run then existing hold behavior remains", () => {
    // given
    const normal = createTask("normal")
    const created = createManager([normal])

    // when
    const children = created.getTasksByParentSession("parent-session")

    // then
    expect(children).toEqual([normal])
    expect(created.hasActiveChildTasks("parent-session")).toBe(true)
  })
})

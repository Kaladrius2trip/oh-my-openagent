import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { buildTuiRuntimeSnapshot } from "../tui-sidebar/snapshot-builder"
import { BackgroundManager } from "./manager"
import { filterVisibleTasks } from "./task-visibility"
import type { BackgroundTask } from "./types"

const managers: BackgroundManager[] = []
const temporaryDirectories: string[] = []

afterEach(() => {
  while (managers.length > 0) managers.pop()?.shutdown()
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function createTask(id: string, visibility?: "normal" | "internal"): BackgroundTask {
  return {
    id,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: id,
    prompt: "Review",
    agent: "oracle",
    status: "running",
    visibility,
  }
}

function createSnapshotManager(tasks: readonly BackgroundTask[]): BackgroundManager {
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({
      client: { session: {} },
      directory: tmpdir(),
    }),
  })
  const taskMap = unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(manager).tasks
  for (const task of tasks) taskMap.set(task.id, task)
  managers.push(manager)
  return manager
}

describe("background task visibility", () => {
  test("given PR1 policy tests when synchronization is audited then no test awaits an arbitrary delay", () => {
    const testFiles = [
      join(import.meta.dir, "notification-suppression.test.ts"),
      join(import.meta.dir, "task-visibility.test.ts"),
    ]

    const violations = testFiles.filter((testFile) => (
      /await\s+new\s+Promise(?:<[^>]+>)?\s*\(\s*\([^)]*\)\s*=>\s*setTimeout/.test(
        readFileSync(testFile, "utf-8"),
      )
    ))

    expect(violations).toEqual([])
  })

  test("given normal default and internal tasks when snapshots are read then only explicit internal access includes all", () => {
    const tasks = [
      createTask("normal", "normal"),
      createTask("default"),
      createTask("internal", "internal"),
    ]
    const manager = createSnapshotManager(tasks)

    const visibleTitles = manager.getTasksSnapshot().map((task) => task.title)
    expect(visibleTitles).toEqual(["normal", "default"])
    const allTitles = manager.getTasksSnapshotIncludingInternal().map((task) => task.title)
    expect(allTitles).toEqual(["normal", "default", "internal"])
    expect(filterVisibleTasks(tasks).map((task) => task.id)).toEqual(["normal", "default"])
  })

  test("given an internal task when the TUI snapshot is built then the sidebar job board excludes it", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "task-visibility-sidebar-"))
    temporaryDirectories.push(projectDir)
    const manager = createSnapshotManager([
      createTask("normal", "normal"),
      createTask("internal", "internal"),
    ])

    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: unsafeTestValue({ session: {
        status: async () => ({ data: {} }),
        messages: async () => ({ data: [] }),
      } }),
      backgroundManager: manager,
    })

    expect(snapshot.jobBoard.map((row) => row.title)).toEqual(["normal"])
  })

  test("given tmux-enabled normal and internal launches when sessions start then only normal opens a pane", async () => {
    let createdSessions = 0
    let resolveNormalPane: () => void = () => {}
    const normalPaneOpened = new Promise<void>((resolve) => {
      resolveNormalPane = resolve
    })
    const onSubagentSessionCreated = mock(async (event: { title: string }) => {
      if (event.title === "normal") resolveNormalPane()
    })
    const client = {
      session: {
        get: async ({ path }: { path: { id: string } }) => ({
          data: { id: path.id, directory: tmpdir() },
        }),
        create: async () => {
          createdSessions += 1
          return { data: { id: `child-${createdSessions}` } }
        },
        promptAsync: async () => ({ data: {} }),
        abort: async () => ({ data: true }),
      },
    }
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }),
      tmuxConfig: {
        enabled: true,
        layout: "main-vertical",
        main_pane_size: 60,
        main_pane_min_width: 120,
        agent_pane_min_width: 40,
        isolation: "inline",
      },
      onSubagentSessionCreated,
    })
    managers.push(manager)
    const originalTmux = process.env.TMUX
    process.env.TMUX = "/tmp/task-visibility-tmux"

    try {
      const base = {
        prompt: "Review",
        agent: "oracle",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }
      await manager.launch({ ...base, description: "internal", visibility: "internal" })
      await manager.launch({ ...base, description: "normal", visibility: "normal" })
      let diagnosticTimeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          normalPaneOpened,
          new Promise<never>((_resolve, reject) => {
            diagnosticTimeout = setTimeout(
              () => reject(new Error("Timed out waiting for normal task tmux callback")),
              1_000,
            )
          }),
        ])
      } finally {
        if (diagnosticTimeout !== undefined) clearTimeout(diagnosticTimeout)
      }

      expect(onSubagentSessionCreated).toHaveBeenCalledTimes(1)
    } finally {
      if (originalTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = originalTmux
    }
  })
})

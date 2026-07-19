/// <reference types="bun-types" />

import { afterEach, beforeEach, expect, test } from "bun:test"
import { spawn } from "bun"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TmuxConfig } from "../../config/schema"
import type { ExecuteActionsResult } from "./action-executor"
import { TmuxSessionManager, type TmuxUtilDeps } from "./manager"
import { createSessionPaneDeduplicator } from "./session-pane-deduplicator"
import type { PaneAction, WindowState } from "./types"

const LIVE = process.env.OMO_LIVE_TMUX === "1"
const SOCKET_NAME = "pr16qa"
const SESSION_NAME = "pr16qa-main"

type TmuxResult = {
  readonly success: boolean
  readonly output: string
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

type LiveState = {
  readonly managers: TmuxSessionManager[]
  readonly originalTmux: string | undefined
  readonly originalTmuxPane: string | undefined
}

let liveState: LiveState | undefined

async function runTmux(args: readonly string[]): Promise<TmuxResult> {
  const subprocess = spawn(["tmux", "-L", SOCKET_NAME, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  return {
    success: exitCode === 0,
    output: stdout.trim(),
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  }
}

function context(): ConstructorParameters<typeof TmuxSessionManager>[0] {
  return unsafeTestValue<ConstructorParameters<typeof TmuxSessionManager>[0]>({
    directory: process.cwd(),
    serverUrl: new URL("http://127.0.0.1:4096"),
    client: {
      session: {
        status: async () => ({ data: { ses_live_shared: { type: "running" } } }),
        messages: async () => ({ data: [] }),
      },
    },
  })
}

beforeEach(async () => {
  if (!LIVE) return

  await runTmux(["kill-server"])
  const created = await runTmux([
    "new-session",
    "-d",
    "-s",
    SESSION_NAME,
    "-P",
    "-F",
    "#{pane_id}",
  ])
  if (!created.success || !created.stdout) {
    throw new Error(`Failed to create isolated tmux session: ${created.stderr}`)
  }
  const socket = await runTmux([
    "display-message",
    "-p",
    "-t",
    created.stdout,
    "#{socket_path}",
  ])
  if (!socket.success || !socket.stdout) {
    throw new Error(`Failed to resolve isolated tmux socket: ${socket.stderr}`)
  }

  liveState = {
    managers: [],
    originalTmux: process.env.TMUX,
    originalTmuxPane: process.env.TMUX_PANE,
  }
  process.env.TMUX = `${socket.stdout},0,0`
  process.env.TMUX_PANE = created.stdout
})

afterEach(async () => {
  const state = liveState
  liveState = undefined
  if (!state) return

  for (const manager of state.managers) await manager.cleanup()
  process.env.TMUX = state.originalTmux
  process.env.TMUX_PANE = state.originalTmuxPane
  await runTmux(["kill-server"])
})

test.skipIf(!LIVE)("#given two managers on one isolated tmux socket #when one session pane is killed and recreated #then each generation has exactly one tagged pane", async () => {
  // given
  const state = liveState
  if (!state) throw new Error("Live tmux state missing")
  const config = {
    enabled: true,
    isolation: "inline",
    layout: "main-vertical",
    main_pane_size: 60,
    main_pane_min_width: 80,
    agent_pane_min_width: 40,
  } satisfies TmuxConfig
  const windowState: WindowState = {
    windowId: "@0",
    windowWidth: 220,
    windowHeight: 44,
    windowActive: true,
    sessionAttached: true,
    mainPane: {
      paneId: "%0",
      width: 110,
      height: 44,
      left: 0,
      top: 0,
      title: "main",
      isActive: true,
    },
    agentPanes: [],
  }
  const sessionPaneDeduplicator = createSessionPaneDeduplicator({
    isInsideTmux: () => true,
    getTmuxPath: async () => "tmux",
    runTmuxCommand: async (_tmux, args) => runTmux(args),
    log: () => undefined,
  })
  const executeActions = async (actions: PaneAction[]): Promise<ExecuteActionsResult> => {
    const action = actions.find((candidate) => candidate.type === "spawn")
    if (!action || action.type !== "spawn") throw new Error("Expected spawn action")
    const spawned = await runTmux([
      "split-window",
      action.splitDirection,
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      action.targetPaneId,
      "sleep 86400",
    ])
    if (!spawned.success) {
      return {
        success: false,
        results: [{ action, result: { success: false, error: spawned.stderr } }],
      }
    }
    return {
      success: true,
      spawnedPaneId: spawned.stdout,
      results: [{ action, result: { success: true, paneId: spawned.stdout } }],
    }
  }
  const deps = {
    isInsideTmux: () => true,
    getCurrentPaneId: () => "%0",
    queryWindowState: async () => ({ kind: "ok" as const, state: windowState }),
    waitForSessionReady: async () => true,
    executeActions,
    executeAction: async () => ({ success: true }),
    activateTmuxPane: async () => true,
    activateReadOnlyTmuxPane: async () => true,
    sessionPaneDeduplicator,
    log: () => undefined,
  } satisfies TmuxUtilDeps
  const first = new TmuxSessionManager(context(), config, deps)
  const second = new TmuxSessionManager(context(), config, deps)
  unsafeTestValue<{ staleSweepCompleted: boolean }>(first).staleSweepCompleted = true
  unsafeTestValue<{ staleSweepCompleted: boolean }>(second).staleSweepCompleted = true
  state.managers.push(first, second)
  const event = {
    type: "session.created",
    properties: {
      info: { id: "ses_live_shared", parentID: "ses_parent", title: "live shared" },
    },
  }

  // when
  await Promise.all([first.onSessionCreated(event), second.onSessionCreated(event)])
  const panes = await runTmux([
    "list-panes",
    "-s",
    "-F",
    "#{pane_id}\t#{@omo_session}",
  ])

  // then
  expect(panes.success).toBe(true)
  const taggedPanes = panes.stdout.split("\n").filter((line) => line.endsWith("\tses_live_shared"))
  expect(taggedPanes).toHaveLength(1)
  const firstPaneId = taggedPanes[0]?.split("\t", 1)[0]
  if (!firstPaneId) throw new Error("Expected first tagged pane")

  const killed = await runTmux(["kill-pane", "-t", firstPaneId])
  expect(killed.success).toBe(true)
  await Promise.all([
    first.onSessionDeleted({ sessionID: "ses_live_shared" }),
    second.onSessionDeleted({ sessionID: "ses_live_shared" }),
  ])
  await Promise.all([first.onSessionCreated(event), second.onSessionCreated(event)])
  const replacementPanes = await runTmux([
    "list-panes",
    "-s",
    "-F",
    "#{pane_id}\t#{@omo_session}",
  ])
  const taggedReplacementPanes = replacementPanes.stdout
    .split("\n")
    .filter((line) => line.endsWith("\tses_live_shared"))
  expect(taggedReplacementPanes).toHaveLength(1)
  expect(taggedReplacementPanes[0]?.startsWith(`${firstPaneId}\t`)).toBe(false)
})

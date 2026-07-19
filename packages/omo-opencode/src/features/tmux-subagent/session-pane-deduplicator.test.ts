/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"

import type { TmuxCommandResult } from "../../shared/tmux"
import { createSessionPaneDeduplicator } from "./session-pane-deduplicator"

const success = (stdout = ""): TmuxCommandResult => ({
  success: true,
  output: stdout,
  stdout,
  stderr: "",
  exitCode: 0,
})

const failure = (stderr: string): TmuxCommandResult => ({
  success: false,
  output: "",
  stdout: "",
  stderr,
  exitCode: 1,
})

function hasCommand(commands: readonly string[][], expected: readonly string[]): boolean {
  return commands.some((command) =>
    command.length === expected.length
    && command.every((part, index) => part === expected[index]))
}

describe("session pane deduplicator", () => {
  test("#given a pane already tagged for the session #when spawn runs #then existing pane wins without spawning", async () => {
    // given
    const commands: string[][] = []
    const responses = [success(), success("%4\tses_same"), success()]
    let spawnCount = 0
    const deduplicator = createSessionPaneDeduplicator({
      isInsideTmux: () => true,
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (_tmux, args) => {
        commands.push(args)
        return responses.shift() ?? success()
      },
      log: () => undefined,
    })

    // when
    const result = await deduplicator.run(
      "ses_same",
      async () => {
        spawnCount += 1
        return { success: true, spawnedPaneId: "%7" }
      },
      (spawnResult) => spawnResult.spawnedPaneId,
    )

    // then
    expect(result).toEqual({ kind: "existing", paneId: "%4" })
    expect(spawnCount).toBe(0)
    expect(commands).toEqual([
      ["wait-for", "-L", "omo-pane-ses_same"],
      ["list-panes", "-s", "-F", "#{pane_id}\t#{@omo_session}"],
      ["wait-for", "-U", "omo-pane-ses_same"],
    ])
  })

  test("#given no tagged pane #when spawn returns a placeholder pane #then pane is tagged before ownership returns", async () => {
    // given
    const commands: string[][] = []
    const responses = [success(), success(), success(), success("%7\tses_new"), success()]
    const deduplicator = createSessionPaneDeduplicator({
      isInsideTmux: () => true,
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (_tmux, args) => {
        commands.push(args)
        return responses.shift() ?? success()
      },
      log: () => undefined,
    })

    // when
    const result = await deduplicator.run(
      "ses_new",
      async () => ({ success: true, spawnedPaneId: "%7" }),
      (spawnResult) => spawnResult.spawnedPaneId,
    )

    // then
    expect(result).toEqual({
      kind: "spawned",
      result: { success: true, spawnedPaneId: "%7" },
    })
    expect(commands).toEqual([
      ["wait-for", "-L", "omo-pane-ses_new"],
      ["list-panes", "-s", "-F", "#{pane_id}\t#{@omo_session}"],
      ["set-option", "-p", "-t", "%7", "@omo_session", "ses_new"],
      ["list-panes", "-s", "-F", "#{pane_id}\t#{@omo_session}"],
      ["wait-for", "-U", "omo-pane-ses_new"],
    ])
  })

  test("#given a lower pane id claims the same session during spawn #when ownership is rescanned #then later pane kills itself and logs once", async () => {
    // given
    const commands: string[][] = []
    const logs: Array<{ message: string; data?: unknown }> = []
    const responses = [
      success(),
      success(),
      success(),
      success("%3\tses_race\n%7\tses_race"),
      success(),
      success(),
    ]
    const deduplicator = createSessionPaneDeduplicator({
      isInsideTmux: () => true,
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (_tmux, args) => {
        commands.push(args)
        return responses.shift() ?? success()
      },
      log: (message, data) => logs.push({ message, data }),
    })

    // when
    const result = await deduplicator.run(
      "ses_race",
      async () => ({ success: true, spawnedPaneId: "%7" }),
      (spawnResult) => spawnResult.spawnedPaneId,
    )

    // then
    expect(result).toEqual({ kind: "existing", paneId: "%3" })
    expect(hasCommand(commands, ["kill-pane", "-t", "%7"])).toBe(true)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.data).toEqual({
      sessionId: "ses_race",
      ownerPaneId: "%3",
      duplicatePaneId: "%7",
    })
  })

  test("#given tmux locking is unavailable #when spawn falls back #then marker and post-spawn rescan still run", async () => {
    // given
    const commands: string[][] = []
    const responses = [failure("unknown command: wait-for"), success(), success(), success("%9\tses_fallback")]
    const deduplicator = createSessionPaneDeduplicator({
      isInsideTmux: () => true,
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (_tmux, args) => {
        commands.push(args)
        return responses.shift() ?? success()
      },
      log: () => undefined,
    })

    // when
    const result = await deduplicator.run(
      "ses_fallback",
      async () => ({ success: true, spawnedPaneId: "%9" }),
      (spawnResult) => spawnResult.spawnedPaneId,
    )

    // then
    expect(result.kind).toBe("spawned")
    expect(hasCommand(commands, [
      "set-option",
      "-p",
      "-t",
      "%9",
      "@omo_session",
      "ses_fallback",
    ])).toBe(true)
    expect(hasCommand(commands, ["list-panes", "-s", "-F", "#{pane_id}\t#{@omo_session}"])).toBe(true)
  })

  test("#given pane marker write fails #when placeholder was spawned #then untagged pane is discarded", async () => {
    // given
    const commands: string[][] = []
    const responses = [success(), success(), failure("set-option failed"), success(), success()]
    const deduplicator = createSessionPaneDeduplicator({
      isInsideTmux: () => true,
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (_tmux, args) => {
        commands.push(args)
        return responses.shift() ?? success()
      },
      log: () => undefined,
    })

    // when
    const result = await deduplicator.run(
      "ses_untagged",
      async () => ({ success: true, spawnedPaneId: "%11" }),
      (spawnResult) => spawnResult.spawnedPaneId,
    )

    // then
    expect(result.kind).toBe("discarded")
    expect(hasCommand(commands, ["kill-pane", "-t", "%11"])).toBe(true)
  })
})

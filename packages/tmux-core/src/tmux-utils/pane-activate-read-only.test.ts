import { describe, expect, test } from "bun:test"
import type { TmuxCommandResult } from "../runner"
import { activateReadOnlyTmuxPane } from "./pane-activate"

function result(exitCode: number, stderr = ""): TmuxCommandResult {
  return {
    success: exitCode === 0,
    output: "",
    stdout: "",
    stderr,
    exitCode,
  }
}

describe("activateReadOnlyTmuxPane", () => {
  test("#given tmux can disable input #when an observe pane activates #then input is disabled successfully before attach respawns", async () => {
    const calls: string[][] = []
    const results = [result(0), result(0)]

    const activated = await activateReadOnlyTmuxPane(
      "%42",
      "session-1",
      "http://127.0.0.1:4096",
      "/tmp/project",
      {
        isInsideTmux: () => true,
        getTmuxPath: async () => "tmux",
        runTmuxCommand: async (_tmux, args) => {
          calls.push(args)
          return results[calls.length - 1] ?? result(1)
        },
        log: () => undefined,
      },
    )

    expect(activated).toBe(true)
    expect(calls[0]).toEqual(["select-pane", "-d", "-t", "%42"])
    expect(calls[1]?.slice(0, 2)).toEqual(["respawn-pane", "-k"])
    expect(calls[1]?.at(-1)).toContain("opencode attach")
  })

  test("#given tmux cannot disable input #when an observe pane activates #then activation fails closed without attaching", async () => {
    const calls: string[][] = []

    const activated = await activateReadOnlyTmuxPane(
      "%42",
      "session-1",
      "http://127.0.0.1:4096",
      "/tmp/project",
      {
        isInsideTmux: () => true,
        getTmuxPath: async () => "tmux",
        runTmuxCommand: async (_tmux, args) => {
          calls.push(args)
          return result(1, "input disable failed")
        },
        log: () => undefined,
      },
    )

    expect(activated).toBe(false)
    expect(calls).toEqual([["select-pane", "-d", "-t", "%42"]])
    expect(calls.some((args) => args[0] === "respawn-pane")).toBe(false)
  })
})

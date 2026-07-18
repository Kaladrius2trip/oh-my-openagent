import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../../shared/tmux"
import { queryWindowStateWithDeps } from "./pane-state-querier"

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "",
	stdout: "",
	stderr: "",
	exitCode: 0,
}))
const getTmuxPathMock = mock(async (): Promise<string | null> => "sh")
const logMock = mock(() => undefined)

describe("queryWindowState runner integration", () => {
  beforeEach(() => {
    runTmuxCommandMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		runTmuxCommandMock.mockResolvedValue({
			success: true,
			output: "%0\t@3\t120\t40\t0\t0\t1\t120\t40\t1\t1\t\n%1\t@3\t60\t40\t60\t0\t0\t120\t40\t1\t1\tagent",
			stdout: "%0\t@3\t120\t40\t0\t0\t1\t120\t40\t1\t1\t\n%1\t@3\t60\t40\t60\t0\t0\t120\t40\t1\t1\tagent",
			stderr: "",
			exitCode: 0,
		})
    getTmuxPathMock.mockResolvedValue("sh")
  })

	it("#given source pane id #when queryWindowState called #then delegates list-panes to shared runner", async () => {
		// given
    const result = await queryWindowStateWithDeps("%0", {
      getTmuxPath: getTmuxPathMock,
      runTmuxCommand: runTmuxCommandMock,
      log: logMock,
    })

		// then
		expect(result.kind).toBe("ok")
		if (result.kind !== "ok" || !result.state.mainPane) {
			throw new Error("Expected window state")
		}
		expect(result.state.windowId).toBe("@3")
		expect(result.state.mainPane.paneId).toBe("%0")
		expect(result.state.agentPanes.map((pane) => pane.paneId)).toEqual(["%1"])
		expect(runTmuxCommandMock.mock.calls).toEqual([
			[
				expect.any(String),
				[
					"list-panes",
					"-t",
					"%0",
					"-F",
					"#{pane_id}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_left}\t#{pane_top}\t#{pane_active}\t#{window_width}\t#{window_height}\t#{window_active}\t#{session_attached}\t#{pane_title}",
				],
			],
		])
	})

	it("#given list-panes reports missing target #when queryWindowState runs #then returns source_gone", async () => {
		// given
		runTmuxCommandMock.mockResolvedValue({ success: false, output: "", stdout: "", stderr: "can't find pane: %0", exitCode: 1 })

		// when
		const result = await queryWindowStateWithDeps("%0", { getTmuxPath: getTmuxPathMock, runTmuxCommand: runTmuxCommandMock, log: logMock })

		// then
		expect(result).toEqual({ kind: "source_gone" })
	})

	it("#given list-panes reports server failure #when queryWindowState runs #then returns transient detail", async () => {
		// given
		runTmuxCommandMock.mockResolvedValue({ success: false, output: "", stdout: "", stderr: "server exited unexpectedly", exitCode: 1 })

		// when
		const result = await queryWindowStateWithDeps("%0", { getTmuxPath: getTmuxPathMock, runTmuxCommand: runTmuxCommandMock, log: logMock })

		// then
		expect(result).toEqual({ kind: "transient", detail: "server exited unexpectedly" })
	})

	it("#given list-panes output cannot parse #when queryWindowState runs #then returns transient parse detail", async () => {
		// given
		runTmuxCommandMock.mockResolvedValue({ success: true, output: "invalid", stdout: "invalid", stderr: "", exitCode: 0 })

		// when
		const result = await queryWindowStateWithDeps("%0", { getTmuxPath: getTmuxPathMock, runTmuxCommand: runTmuxCommandMock, log: logMock })

		// then
		expect(result).toEqual({ kind: "transient", detail: "failed to parse list-panes output" })
	})
})

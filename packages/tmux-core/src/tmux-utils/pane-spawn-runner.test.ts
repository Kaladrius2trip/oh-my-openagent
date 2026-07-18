/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxConfig } from "../types"
import type { TmuxCommandResult } from "../runner"

const paneSpawnSpecifier = import.meta.resolve("./pane-spawn")

const enabledTmuxConfig = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "%42",
	stdout: "%42",
	stderr: "",
	exitCode: 0,
}))
const isInsideTmuxMock = mock((): boolean => true)
const isServerRunningMock = mock(async (): Promise<boolean> => true)
const getTmuxPathMock = mock(async (): Promise<string | null> => "sh")
const logMock = mock(() => undefined)
const delayMock = mock(async (_milliseconds: number): Promise<void> => undefined)

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Expected array value")
	}

	const items: string[] = []
	for (const item of value) {
		items.push(String(item))
	}
	return items
}

function getRunTmuxCommandCall(index: number): [string, string[]] {
	const call = Reflect.get(runTmuxCommandMock.mock.calls, index)
	const command = Reflect.get(call, 0)
	const args = Reflect.get(call, 1)
	if (!Array.isArray(call) || typeof command !== "string" || !Array.isArray(args)) {
		throw new Error(`Expected tmux runner call at index ${index}`)
	}

	return [command, toStringArray(args)]
}

function getSplitWindowCommand(): string {
	const firstCall = getRunTmuxCommandCall(0)
	const splitCommand = firstCall[1].at(-1)
	if (splitCommand === undefined) {
		throw new Error("Expected split-window command")
	}

	return splitCommand
}

function createDeps() {
	return {
		log: logMock,
		runTmuxCommand: runTmuxCommandMock,
		isInsideTmux: isInsideTmuxMock,
		isServerRunning: isServerRunningMock,
		getTmuxPath: getTmuxPathMock,
		delay: delayMock,
	}
}

async function loadSpawnTmuxPane(): Promise<typeof import("./pane-spawn").spawnTmuxPane> {
	const module = await import(`${paneSpawnSpecifier}?test=${crypto.randomUUID()}`)
	return module.spawnTmuxPane
}

describe("spawnTmuxPane runner integration", () => {
	beforeEach(() => {
		mock.restore()
		runTmuxCommandMock.mockClear()
		isInsideTmuxMock.mockClear()
		isServerRunningMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()
		delayMock.mockClear()

		const tmuxCommandResults: TmuxCommandResult[] = [
			{ success: true, output: "%42", stdout: "%42", stderr: "", exitCode: 0 },
			{ success: true, output: "", stdout: "", stderr: "", exitCode: 0 },
		]
		runTmuxCommandMock.mockImplementation(async (): Promise<TmuxCommandResult> => {
			const nextResult = tmuxCommandResults.shift()
			if (!nextResult) {
				throw new Error("No more tmux command results configured")
			}
			return nextResult
		})
		isInsideTmuxMock.mockReturnValue(true)
		isServerRunningMock.mockResolvedValue(true)
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given healthy tmux environment #when spawnTmuxPane called #then delegates split-window and select-pane to shared runner", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		const directory = "/tmp/omo-project/(pane)"

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory, "%0", "-h", createDeps())

		// then
		const firstCall = getRunTmuxCommandCall(0)
		const secondCall = getRunTmuxCommandCall(1)
		expect(result).toEqual({ kind: "ok", paneId: "%42" })
		expect(firstCall[1].slice(0, 8)).toEqual(["split-window", "-h", "-d", "-P", "-F", "#{pane_id}", "-t", "%0"])
		expect(secondCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(getSplitWindowCommand()).toContain("Focus this pane to attach.")
		expect(getSplitWindowCommand()).toContain("while :; do sleep 86400; done")
		expect(getSplitWindowCommand()).not.toContain("opencode attach")
	})

	it("#given split-window reports no capacity #when spawnTmuxPane runs #then returns transient stderr without hot retry", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		runTmuxCommandMock.mockResolvedValue({
			success: false,
			output: "",
			stdout: "",
			stderr: "no space for new pane",
			exitCode: 1,
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/tmp", "%0", "-h", createDeps())

		// then
		expect(result).toEqual({ kind: "transient", stderr: "no space for new pane" })
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(1)
		expect(delayMock).not.toHaveBeenCalled()
	})

	it("#given split-window succeeds without pane id #when spawnTmuxPane runs #then returns transient failure without retrying the non-idempotent split", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		runTmuxCommandMock.mockResolvedValue({
			success: true,
			output: "",
			stdout: "",
			stderr: "",
			exitCode: 0,
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/tmp", "%0", "-h", createDeps())

		// then
		expect(result).toEqual({ kind: "transient", stderr: "tmux split-window returned no pane id" })
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(1)
		expect(delayMock).not.toHaveBeenCalled()
	})

	it("#given split-window target disappeared #when spawnTmuxPane runs #then returns terminal stderr without retry", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		runTmuxCommandMock.mockResolvedValue({
			success: false,
			output: "",
			stdout: "",
			stderr: "can't find pane: %0",
			exitCode: 1,
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/tmp", "%0", "-h", createDeps())

		// then
		expect(result).toEqual({ kind: "terminal", stderr: "can't find pane: %0" })
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(1)
	})

	it("#given split-window server errors persist #when spawnTmuxPane runs #then retries twice in slot before returning transient", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		runTmuxCommandMock.mockResolvedValue({
			success: false,
			output: "",
			stdout: "",
			stderr: "server exited unexpectedly",
			exitCode: 1,
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/tmp", "%0", "-h", createDeps())

		// then
		expect(result).toEqual({ kind: "transient", stderr: "server exited unexpectedly" })
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(3)
		expect(delayMock.mock.calls).toEqual([[250], [250]])
	})

	it("#given split-window returns unknown failure #when spawnTmuxPane runs #then retries once before returning transient", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		runTmuxCommandMock.mockResolvedValue({
			success: false,
			output: "",
			stdout: "",
			stderr: "unexpected tmux failure",
			exitCode: 1,
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/tmp", "%0", "-h", createDeps())

		// then
		expect(result).toEqual({ kind: "transient", stderr: "unexpected tmux failure" })
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(2)
		expect(delayMock).toHaveBeenCalledTimes(1)
	})

	it("#given split-window rejects an option #when spawnTmuxPane runs #then returns terminal stderr without retry", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		runTmuxCommandMock.mockResolvedValue({
			success: false,
			output: "",
			stdout: "",
			stderr: "unknown option --bad",
			exitCode: 1,
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/tmp", "%0", "-h", createDeps())

		// then
		expect(result).toEqual({ kind: "terminal", stderr: "unknown option --bad" })
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(1)
		expect(logMock).toHaveBeenCalledWith("[spawnTmuxPane] split-window failed", expect.objectContaining({ stderr: "unknown option --bad" }))
	})

	it("#given description with spaces #when spawnTmuxPane called #then includes it in the placeholder", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()

		// when
		await spawnTmuxPane("session-1", "worker with spaces", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here", "%0", "-h", createDeps())

		// then
		expect(getSplitWindowCommand()).toContain("OMO subagent pane ready: worker with spaces")
	})

	it("#given empty directory #when spawnTmuxPane called #then keeps the placeholder detached from attach", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "", "%0", "-h", createDeps())

		// then
		expect(getSplitWindowCommand()).not.toContain("--dir")
	})

	it("#given description with shell metacharacters #when spawnTmuxPane called #then escapes the placeholder", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()

		// when
		await spawnTmuxPane("session-1", 'worker "$(whoami)"', enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote", "%0", "-h", createDeps())

		// then
		expect(getSplitWindowCommand()).toContain('\\"')
		expect(getSplitWindowCommand()).toContain("\\$")
	})
})

import type { TmuxConfig } from "../types"
import type { SpawnResult } from "../types"
import { classifyTmuxError, getPaneSpawnRetryLimit, type runTmuxCommand as RunTmuxCommand } from "../runner"
import type { SplitDirection } from "./environment"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { buildPaneAuthEnvironmentArgs, buildTmuxPlaceholderCommand } from "./pane-command"

export type SpawnTmuxPaneDeps = {
	readonly log: (message: string, data?: unknown) => void
	readonly runTmuxCommand: typeof RunTmuxCommand
	readonly isInsideTmux: typeof isInsideTmux
	readonly isServerRunning: typeof isServerRunning
	readonly getTmuxPath: () => Promise<string | null | undefined>
	readonly delay: (milliseconds: number) => Promise<void>
}

async function resolveSpawnTmuxPaneDeps(deps?: Partial<SpawnTmuxPaneDeps>): Promise<SpawnTmuxPaneDeps> {
	const { runTmuxCommand } = await import("../runner")

	return {
		log: () => undefined,
		runTmuxCommand,
		isInsideTmux,
		isServerRunning,
		getTmuxPath: async () => null,
		delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		...deps,
	}
}

export async function spawnTmuxPane(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	_directory: string,
	targetPaneId?: string,
	splitDirection: SplitDirection = "-h",
	depsInput?: Partial<SpawnTmuxPaneDeps>,
): Promise<SpawnResult> {
	const deps = await resolveSpawnTmuxPaneDeps(depsInput)
	const { log, runTmuxCommand } = deps

	log("[spawnTmuxPane] called", {
		sessionId,
		description,
		serverUrl,
		configEnabled: config.enabled,
		targetPaneId,
		splitDirection,
	})

	if (!config.enabled) {
		log("[spawnTmuxPane] SKIP: config.enabled is false")
		return { kind: "terminal", stderr: "tmux integration disabled" }
	}
	if (!deps.isInsideTmux()) {
		log("[spawnTmuxPane] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { kind: "terminal", stderr: "not inside tmux" }
	}

	const serverRunning = await deps.isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxPane] SKIP: server not running", { serverUrl })
		return { kind: "transient", stderr: "OpenCode server not running" }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxPane] SKIP: tmux not found")
		return { kind: "terminal", stderr: "tmux binary not found" }
	}

	log("[spawnTmuxPane] all checks passed, spawning...")

	const placeholderCmd = buildTmuxPlaceholderCommand(description)
	const authEnvArgs = buildPaneAuthEnvironmentArgs()

	const args = [
		"split-window",
		splitDirection,
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		...(targetPaneId ? ["-t", targetPaneId] : []),
		...authEnvArgs,
		placeholderCmd,
	]

	let result = await runTmuxCommand(tmux, args)
	let retryCount = 0
	while (result.exitCode !== 0) {
		const detail = result.stderr.trim() || "tmux split-window returned no pane id"
		const retryLimit = getPaneSpawnRetryLimit(detail)
		if (retryCount >= retryLimit) {
			const errorKind = classifyTmuxError(detail)
			const kind = errorKind === "target_gone" || errorKind === "terminal" ? "terminal" : "transient"
			log("[spawnTmuxPane] split-window failed", {
				exitCode: result.exitCode,
				stderr: detail,
				retryCount,
				errorKind,
			})
			return { kind, stderr: detail }
		}

		retryCount += 1
		await deps.delay(250)
		result = await runTmuxCommand(tmux, args)
	}
	if (!result.output) {
		const stderr = "tmux split-window returned no pane id"
		log("[spawnTmuxPane] split-window succeeded without pane id", { stderr })
		return { kind: "transient", stderr }
	}
	const paneId = result.output

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleResult = await runTmuxCommand(tmux, ["select-pane", "-t", paneId, "-T", title])
	if (titleResult.exitCode !== 0) {
		log("[spawnTmuxPane] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleResult.exitCode,
			stderr: titleResult.stderr.trim(),
		})
	}

	return { kind: "ok", paneId }
}

import { spawn } from "@oh-my-opencode/utils/runtime"
import { isCmuxCompatEnvironment } from "./cmux-detect"

type RunTmuxOptions = {
	retry?: number
	timeoutMs?: number
}

export type TmuxCommandResult = {
	success: boolean
	output: string
	stdout: string
	stderr: string
	exitCode: number
}

const TARGET_GONE_PATTERN = /(?:can't find|no such) (?:pane|session|window)|unknown target/i
const CAPACITY_PATTERN = /no space for new pane/i
const SERVER_TRANSIENT_PATTERN = /server exited unexpectedly|no server running|failed to connect to server|lost server|connection (?:refused|reset)|socket/i
const TERMINAL_PATTERN = /unknown option|invalid option|command not found|no such file or directory|permission denied|not executable/i

export type TmuxErrorKind = "target_gone" | "capacity" | "server_transient" | "terminal" | "unknown"

const PANE_SPAWN_RETRY_LIMITS = {
	target_gone: 0,
	capacity: 0,
	server_transient: 2,
	terminal: 0,
	unknown: 1,
} as const satisfies Record<TmuxErrorKind, 0 | 1 | 2>

function createTmuxCommandResult(stdout: string, stderr: string, exitCode: number): TmuxCommandResult {
	return {
		success: exitCode === 0,
		output: stdout,
		stdout,
		stderr,
		exitCode,
	}
}

export function classifyTmuxError(stderr: string): TmuxErrorKind {
	if (TARGET_GONE_PATTERN.test(stderr)) return "target_gone"
	if (CAPACITY_PATTERN.test(stderr)) return "capacity"
	if (SERVER_TRANSIENT_PATTERN.test(stderr)) return "server_transient"
	if (TERMINAL_PATTERN.test(stderr)) return "terminal"
	return "unknown"
}

export function getPaneSpawnRetryLimit(stderr: string): 0 | 1 | 2 {
	return PANE_SPAWN_RETRY_LIMITS[classifyTmuxError(stderr)]
}

export function isTerminalTmuxError(stderr: string): boolean {
	const kind = classifyTmuxError(stderr)
	return kind === "target_gone" || kind === "capacity" || kind === "terminal"
}

function resolveTmuxExecutable(tmuxPath: string): string[] {
	if (!isCmuxCompatEnvironment()) {
		return [tmuxPath]
	}

	const executableName = tmuxPath.split(/[\\/]/).pop()
	const cmuxExecutable = executableName && /^cmux(?:\.(?:bat|cmd|exe|ps1))?$/i.test(executableName) ? tmuxPath : "cmux"
	return [cmuxExecutable, "__tmux-compat"]
}

async function runTmuxCommandOnce(tmuxPath: string, args: Array<string>, timeoutMs?: number): Promise<TmuxCommandResult> {
	const abortController = new AbortController()
	const subprocess = spawn([...resolveTmuxExecutable(tmuxPath), ...args], {
		stdout: "pipe",
		stderr: "pipe",
		signal: abortController.signal,
	})
	const stdoutPromise = new Response(subprocess.stdout).text()
	const stderrPromise = new Response(subprocess.stderr).text()

	let timeoutId: ReturnType<typeof setTimeout> | undefined

	try {
		const exitCodeOrTimeout = timeoutMs === undefined
			? await subprocess.exited
			: await Promise.race<number | "timeout">(([
					subprocess.exited,
					new Promise<"timeout">((resolve) => {
						timeoutId = setTimeout(() => {
							abortController.abort()
							resolve("timeout")
						}, timeoutMs)
					}),
				]))

		if (exitCodeOrTimeout === "timeout") {
			void subprocess.exited.catch(() => undefined)
			void stdoutPromise.catch(() => "")
			void stderrPromise.catch(() => "")
			return createTmuxCommandResult("", "timeout", -1)
		}

		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
		return createTmuxCommandResult(stdout.trim(), stderr.trim(), exitCodeOrTimeout)
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId)
		}
	}
}

export async function runTmuxCommand(tmuxPath: string, args: string[], options: RunTmuxOptions = {}): Promise<TmuxCommandResult> {
	const retryCount = Math.max(0, options.retry ?? 0)
	let lastResult = createTmuxCommandResult("", "", 1)

	for (let attempt = 0; attempt <= retryCount; attempt += 1) {
		const result = await runTmuxCommandOnce(tmuxPath, args, options.timeoutMs)
		lastResult = result

		if (result.exitCode === 0) {
			return result
		}

		if (attempt === retryCount || isTerminalTmuxError(result.stderr)) {
			return result
		}
	}

	return lastResult
}

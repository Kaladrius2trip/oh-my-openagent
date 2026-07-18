import type { TmuxConfig } from "../../config/schema"
import type { applyLayout, closeTmuxPane, enforceMainPaneWidth, replaceTmuxPane, spawnTmuxPane } from "../../shared/tmux"
import type { PaneAction, WindowState } from "./types"
import type { SpawnResult } from "../../shared/tmux"

export type TmuxSpawnFailure = Exclude<SpawnResult, { readonly kind: "ok" }>

export interface ActionResult {
	success: boolean
	paneId?: string
	error?: string
	tmuxFailure?: TmuxSpawnFailure
}

function truncateStderr(stderr: string): string {
	return stderr.length <= 240 ? stderr : `${stderr.slice(0, 240)}...`
}

export function createSpawnActionResult(result: SpawnResult): ActionResult {
	switch (result.kind) {
		case "ok":
			return { success: true, paneId: result.paneId }
		case "transient":
		case "terminal":
			return {
				success: false,
				error: truncateStderr(result.stderr),
				tmuxFailure: result,
			}
	}
}

export interface ExecuteContext {
	config: TmuxConfig
	directory: string
	serverUrl: string
	windowState: WindowState
}

export interface ActionExecutorDeps {
	spawnTmuxPane: typeof spawnTmuxPane
	closeTmuxPane: typeof closeTmuxPane
	replaceTmuxPane: typeof replaceTmuxPane
	applyLayout: typeof applyLayout
	enforceMainPaneWidth: typeof enforceMainPaneWidth
}

async function enforceMainPane(
	windowState: WindowState,
	config: TmuxConfig,
	deps: ActionExecutorDeps,
): Promise<void> {
	if (!windowState.mainPane) return
	await deps.enforceMainPaneWidth(
		windowState.mainPane.paneId,
		windowState.windowWidth,
		config.main_pane_size,
	)
}

export async function executeActionWithDeps(
	action: PaneAction,
	ctx: ExecuteContext,
	deps: ActionExecutorDeps,
): Promise<ActionResult> {
	if (action.type === "close") {
		const success = await deps.closeTmuxPane(action.paneId)
		if (success) {
			await enforceMainPane(ctx.windowState, ctx.config, deps)
		}
		return { success }
	}

	if (action.type === "replace") {
		const result = await deps.replaceTmuxPane(
			action.paneId,
			action.newSessionId,
			action.description,
			ctx.config,
			ctx.serverUrl,
			ctx.directory,
		)
		return {
			success: result.success,
			paneId: result.paneId,
		}
	}

	const result = await deps.spawnTmuxPane(
		action.sessionId,
		action.description,
		ctx.config,
		ctx.serverUrl,
		ctx.directory,
		action.targetPaneId,
		action.splitDirection,
	)

	if (result.kind === "ok") {
		await enforceMainPane(ctx.windowState, ctx.config, deps)
	}

	return createSpawnActionResult(result)
}

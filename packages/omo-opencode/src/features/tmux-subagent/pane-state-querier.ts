import type { WindowState, WindowStateQueryResult, TmuxPaneInfo } from "./types"
import { parsePaneStateOutput } from "./pane-state-parser"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../shared"
import type { TmuxCommandResult } from "../../shared/tmux"
import { classifyTmuxError } from "../../shared/tmux"

type QueryWindowStateDeps = {
  getTmuxPath: typeof getTmuxPath
  runTmuxCommand: (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>
  log: typeof log
}

export async function queryWindowStateWithDeps(sourcePaneId: string, deps: QueryWindowStateDeps): Promise<WindowStateQueryResult> {
  const tmux = await deps.getTmuxPath()
  if (!tmux) return { kind: "transient", detail: "tmux binary unavailable" }

  const result = await deps.runTmuxCommand(tmux, [
    "list-panes",
    "-t",
    sourcePaneId,
    "-F",
		"#{pane_id}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_left}\t#{pane_top}\t#{pane_active}\t#{window_width}\t#{window_height}\t#{window_active}\t#{session_attached}\t#{pane_title}",
  ])

	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || `list-panes exited ${result.exitCode}`
		deps.log("[pane-state-querier] list-panes failed", { exitCode: result.exitCode, stderr: detail })
		return classifyTmuxError(detail) === "target_gone"
			? { kind: "source_gone" }
			: { kind: "transient", detail }
	}

	const parsedPaneState = parsePaneStateOutput(result.output)
  if (!parsedPaneState) {
    deps.log("[pane-state-querier] failed to parse pane state output", {
      sourcePaneId,
    })
    return { kind: "transient", detail: "failed to parse list-panes output" }
  }

  const { panes } = parsedPaneState
  const windowWidth = parsedPaneState.windowWidth
  const windowHeight = parsedPaneState.windowHeight
  const windowActive = parsedPaneState.windowActive
  const sessionAttached = parsedPaneState.sessionAttached

  panes.sort((a, b) => a.left - b.left || a.top - b.top)

  const mainPane = panes.reduce<TmuxPaneInfo | null>((selected, pane) => {
    if (!selected) return pane
    if (pane.left !== selected.left) {
      return pane.left < selected.left ? pane : selected
    }
    if (pane.width !== selected.width) {
      return pane.width > selected.width ? pane : selected
    }
    if (pane.top !== selected.top) {
      return pane.top < selected.top ? pane : selected
    }
    return pane.paneId === sourcePaneId ? pane : selected
  }, null)
  if (!mainPane) {
    deps.log("[pane-state-querier] CRITICAL: failed to determine main pane", {
      sourcePaneId,
      availablePanes: panes.map((p) => p.paneId),
    })
    return { kind: "transient", detail: "failed to determine main pane" }
  }

  const agentPanes = panes.filter((p) => p.paneId !== mainPane.paneId)

  deps.log("[pane-state-querier] window state", {
    windowWidth,
    windowHeight,
    mainPane: mainPane.paneId,
    agentPaneCount: agentPanes.length,
  })

  return {
    kind: "ok",
    state: {
      windowId: parsedPaneState.windowId,
      windowWidth,
      windowHeight,
      windowActive,
      sessionAttached,
      mainPane,
      agentPanes,
    },
  }
}

export async function queryWindowState(sourcePaneId: string): Promise<WindowStateQueryResult> {
  const { runTmuxCommand } = await import("../../shared/tmux")
  return queryWindowStateWithDeps(sourcePaneId, { getTmuxPath, runTmuxCommand, log })
}

/**
 * Collapse a typed window-state result to the legacy `WindowState | null`
 * shape for call sites that only need the state or its absence. Both failure
 * kinds (source_gone, transient) map to null; only `ok` yields the state.
 * Sites that must distinguish a missing source pane from a transient failure
 * branch on the `kind` directly instead of using this helper.
 */
export function unwrapWindowState(result: WindowStateQueryResult): WindowState | null {
  return result.kind === "ok" ? result.state : null
}

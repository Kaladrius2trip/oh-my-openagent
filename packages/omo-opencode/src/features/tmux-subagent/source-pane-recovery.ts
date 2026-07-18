import type { TmuxPaneInfo, WindowState, WindowStateQueryResult } from "./types"

export interface SourcePaneRecovery {
  getPaneId: () => string | undefined
  queryWindowState: () => Promise<WindowStateQueryResult>
  recoverAfterTargetLoss: () => Promise<WindowStateQueryResult>
}

export interface SourcePaneRecoveryInput {
  readonly initialPaneId: string | undefined
  readonly queryWindowState: (target: string) => Promise<WindowStateQueryResult>
  readonly getManagedPaneIds: () => ReadonlySet<string>
  readonly log: (message: string, data?: unknown) => void
}

function getPanes(state: WindowState): readonly TmuxPaneInfo[] {
  return state.mainPane ? [state.mainPane, ...state.agentPanes] : state.agentPanes
}

export function createSourcePaneRecovery(input: SourcePaneRecoveryInput): SourcePaneRecovery {
  let paneId = input.initialPaneId
  let originalWindowId: string | undefined

  function rememberOriginalWindow(state: WindowState): void {
    if (originalWindowId === undefined && state.windowId !== undefined) {
      originalWindowId = state.windowId
    }
  }

  function unavailable(reason: string, data?: unknown): WindowStateQueryResult {
    input.log("[tmux-session-manager] source pane re-resolution unavailable for batch", {
      reason,
      originalWindowId,
      sourcePaneId: paneId,
      detail: data,
    })
    return { kind: "source_gone" }
  }

  async function resolveFromOriginalWindow(): Promise<WindowStateQueryResult> {
    if (originalWindowId === undefined) {
      return unavailable("original window unknown")
    }

    const windowResult = await input.queryWindowState(originalWindowId)
    switch (windowResult.kind) {
      case "source_gone":
        return unavailable("original window gone")
      case "transient":
        input.log("[tmux-session-manager] source pane re-resolution query failed for batch", {
          originalWindowId,
          detail: windowResult.detail,
        })
        return windowResult
      case "ok": {
        if (windowResult.state.sessionAttached !== true) {
          return unavailable("original window is not attached")
        }
        const managedPaneIds = input.getManagedPaneIds()
        const candidates = getPanes(windowResult.state).filter(
          (pane) => pane.isActive && !managedPaneIds.has(pane.paneId),
        )
        if (candidates.length !== 1) {
          return unavailable("active source candidate ambiguous", {
            candidatePaneIds: candidates.map((candidate) => candidate.paneId),
            managedPaneIds: Array.from(managedPaneIds),
          })
        }
        const candidate = candidates[0]
        if (!candidate) {
          return unavailable("active source candidate missing")
        }
        paneId = candidate.paneId
        input.log("[tmux-session-manager] source pane re-resolved", {
          originalWindowId,
          sourcePaneId: paneId,
        })
        return windowResult
      }
    }
  }

  return {
    getPaneId: () => paneId,
    recoverAfterTargetLoss: resolveFromOriginalWindow,
    queryWindowState: async () => {
      if (paneId === undefined) {
        return { kind: "transient", detail: "source pane unavailable" }
      }
      const result = await input.queryWindowState(paneId)
      switch (result.kind) {
        case "ok":
          rememberOriginalWindow(result.state)
          return result
        case "transient":
          return result
        case "source_gone":
          return resolveFromOriginalWindow()
      }
    },
  }
}

import {
  activateReadOnlyTmuxPane as activateReadOnlyTmuxPaneCore,
  activateTmuxPane as activateTmuxPaneCore,
} from "@oh-my-opencode/tmux-core"
import { paneActivateDeps } from "./adapter-deps"

export async function activateTmuxPane(
  paneId: string,
  sessionId: string,
  serverUrl: string,
  directory: string,
): Promise<boolean> {
  return activateTmuxPaneCore(paneId, sessionId, serverUrl, directory, paneActivateDeps())
}

export async function activateReadOnlyTmuxPane(
  paneId: string,
  sessionId: string,
  serverUrl: string,
  directory: string,
): Promise<boolean> {
  return activateReadOnlyTmuxPaneCore(paneId, sessionId, serverUrl, directory, paneActivateDeps())
}

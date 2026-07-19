import { log } from "../../shared"
import { isInsideTmux, runTmuxCommand } from "../../shared/tmux"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"

const PANE_SESSION_OPTION = "@omo_session"
const PANE_FORMAT = `#{pane_id}\t#{${PANE_SESSION_OPTION}}`

type SessionPaneDeduplicatorDeps = {
  readonly isInsideTmux: () => boolean
  readonly getTmuxPath: () => Promise<string | null>
  readonly runTmuxCommand: typeof runTmuxCommand
  readonly log: typeof log
}

export type DeduplicatedSpawnResult<T> =
  | { readonly kind: "spawned"; readonly result: T }
  | { readonly kind: "existing"; readonly paneId: string }
  | { readonly kind: "discarded"; readonly result: T }

export interface SessionPaneDeduplicator {
  run<T>(
    sessionId: string,
    spawn: () => Promise<T>,
    getSpawnedPaneId: (result: T) => string | undefined,
  ): Promise<DeduplicatedSpawnResult<T>>
}

const defaultDeps: SessionPaneDeduplicatorDeps = {
  isInsideTmux,
  getTmuxPath,
  runTmuxCommand,
  log,
}

function parseSessionPaneIds(output: string, sessionId: string): string[] {
  return output
    .split("\n")
    .map((line) => line.split("\t", 2))
    .filter((parts) => parts[1] === sessionId)
    .map((parts) => parts[0])
    .filter((paneId): paneId is string => paneId !== undefined && paneId.length > 0)
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
}

async function listSessionPaneIds(
  tmux: string,
  sessionId: string,
  deps: SessionPaneDeduplicatorDeps,
): Promise<string[]> {
  const result = await deps.runTmuxCommand(tmux, ["list-panes", "-s", "-F", PANE_FORMAT])
  return result.success ? parseSessionPaneIds(result.stdout, sessionId) : []
}

export function createSessionPaneDeduplicator(
  depsInput: Partial<SessionPaneDeduplicatorDeps> = {},
): SessionPaneDeduplicator {
  const deps = { ...defaultDeps, ...depsInput }

  return {
    async run<T>(
      sessionId: string,
      spawn: () => Promise<T>,
      getSpawnedPaneId: (result: T) => string | undefined,
    ): Promise<DeduplicatedSpawnResult<T>> {
      const tmux = deps.isInsideTmux() ? await deps.getTmuxPath() : null
      if (!tmux) {
        return { kind: "spawned", result: await spawn() }
      }

      const spawnAndClaim = async (): Promise<DeduplicatedSpawnResult<T>> => {
        const existingPaneId = (await listSessionPaneIds(tmux, sessionId, deps))[0]
        if (existingPaneId) {
          return { kind: "existing", paneId: existingPaneId }
        }

        const result = await spawn()
        const spawnedPaneId = getSpawnedPaneId(result)
        if (!spawnedPaneId) {
          return { kind: "spawned", result }
        }

        const markerResult = await deps.runTmuxCommand(tmux, [
          "set-option",
          "-p",
          "-t",
          spawnedPaneId,
          PANE_SESSION_OPTION,
          sessionId,
        ])
        if (!markerResult.success) {
          await deps.runTmuxCommand(tmux, ["kill-pane", "-t", spawnedPaneId])
          deps.log("[tmux-session-manager] untagged session pane removed", {
            sessionId,
            paneId: spawnedPaneId,
            error: markerResult.stderr,
          })
          return { kind: "discarded", result }
        }
        const ownerPaneId = (await listSessionPaneIds(tmux, sessionId, deps))[0]
        if (ownerPaneId && ownerPaneId !== spawnedPaneId) {
          await deps.runTmuxCommand(tmux, ["kill-pane", "-t", spawnedPaneId])
          deps.log("[tmux-session-manager] duplicate session pane removed", {
            sessionId,
            ownerPaneId,
            duplicatePaneId: spawnedPaneId,
          })
          return { kind: "existing", paneId: ownerPaneId }
        }
        return { kind: "spawned", result }
      }

      const lockName = `omo-pane-${sessionId}`
      const lockResult = await deps.runTmuxCommand(tmux, ["wait-for", "-L", lockName])
      if (!lockResult.success) {
        return spawnAndClaim()
      }

      try {
        return await spawnAndClaim()
      } finally {
        await deps.runTmuxCommand(tmux, ["wait-for", "-U", lockName])
      }
    },
  }
}

import type { SessionPaneDeduplicator } from "./session-pane-deduplicator"

export const passthroughSessionPaneDeduplicator: SessionPaneDeduplicator = {
  async run<T>(_sessionId: string, spawn: () => Promise<T>) {
    return { kind: "spawned", result: await spawn() }
  },
}

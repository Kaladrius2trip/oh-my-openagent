import type { TmuxPaneMode, TrackedSession } from "./types"

export function createTrackedSession(params: {
  sessionId: string
  paneId: string
  description: string
  mode?: TmuxPaneMode
  now?: Date
}): TrackedSession {
  const now = params.now ?? new Date()

  return {
    sessionId: params.sessionId,
    paneId: params.paneId,
    description: params.description,
    mode: params.mode ?? "interactive",
    attachActivated: false,
    attachActivatedAt: undefined,
    createdAt: now,
    lastSeenAt: now,
    closePending: false,
    closeRetryCount: 0,
    activityVersion: 0,
  }
}

export function markTrackedSessionActivated(tracked: TrackedSession, now = new Date()): void {
  tracked.attachActivated = true
  tracked.attachActivatedAt = now
  tracked.lastSeenAt = now
  tracked.stableIdlePolls = 0
  tracked.observedIdleActivityVersion = tracked.activityVersion
}

export function markTrackedSessionClosePending(tracked: TrackedSession): TrackedSession {
  return {
    ...tracked,
    closePending: true,
    closeRetryCount: tracked.closePending ? tracked.closeRetryCount + 1 : tracked.closeRetryCount,
  }
}

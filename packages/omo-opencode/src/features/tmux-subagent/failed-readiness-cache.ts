import type { TmuxPaneMode } from "./types"

export interface FailedReadinessSessionSeed {
  sessionId: string
  title: string
  mode: TmuxPaneMode
}

export interface FailedReadinessSession extends FailedReadinessSessionSeed {
  rememberedAt: number
}

export interface FailedReadinessCacheOptions {
  readonly ttlMs: number
}

export class FailedReadinessCache {
  private readonly sessions = new Map<string, FailedReadinessSession>()
  private readonly ttlMs: number

  constructor(options: FailedReadinessCacheOptions) {
    this.ttlMs = options.ttlMs
  }

  get size(): number {
    return this.sessions.size
  }

  remember(session: FailedReadinessSessionSeed, rememberedAt: number = Date.now()): void {
    const existing = this.sessions.get(session.sessionId)
    this.sessions.set(session.sessionId, {
      ...session,
      rememberedAt: existing?.rememberedAt ?? rememberedAt,
    })
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  get(sessionId: string): FailedReadinessSession | undefined {
    return this.sessions.get(sessionId)
  }

  values(): readonly FailedReadinessSession[] {
    return Array.from(this.sessions.values())
  }

  takeExpired(now: number = Date.now()): readonly FailedReadinessSession[] {
    const expired: FailedReadinessSession[] = []
    for (const [sessionId, session] of this.sessions) {
      if (now - session.rememberedAt < this.ttlMs) continue
      expired.push(session)
      this.sessions.delete(sessionId)
    }
    return expired
  }

  clearAll(): void {
    this.sessions.clear()
  }
}

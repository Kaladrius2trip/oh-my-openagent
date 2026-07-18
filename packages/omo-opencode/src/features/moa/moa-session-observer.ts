export interface MoASessionObserver {
  openSession(sessionId: string, title: string): Promise<void>
  closeSession(sessionId: string): Promise<void>
}

type ObserverLog = (message: string, data?: unknown) => void

export class MoAChildSessionObserver {
  private currentSessionId: string | undefined
  private disposed = false
  private disposal: Promise<void> | undefined
  private operations: Promise<void> = Promise.resolve()

  constructor(
    private readonly observer: MoASessionObserver,
    private readonly title: string,
    private readonly log: ObserverLog,
  ) {}

  readonly onSessionCreated = (sessionId: string): Promise<void> => {
    if (this.disposed) return Promise.resolve()

    return this.enqueue(async () => {
      if (this.currentSessionId === sessionId) return

      if (this.currentSessionId !== undefined) {
        await this.close(this.currentSessionId)
      }

      try {
        await this.observer.openSession(sessionId, this.title)
        this.currentSessionId = sessionId
      } catch (error) {
        this.log("[moa-session-observer] failed to open observe-only session", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal

    this.disposed = true
    this.disposal = this.enqueue(async () => {
      if (this.currentSessionId !== undefined) {
        await this.close(this.currentSessionId)
      }
    })
    return this.disposal
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.operations = this.operations.then(operation).catch((error) => {
      this.log("[moa-session-observer] observer operation failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return this.operations
  }

  private async close(sessionId: string): Promise<void> {
    this.currentSessionId = undefined
    try {
      await this.observer.closeSession(sessionId)
    } catch (error) {
      this.log("[moa-session-observer] failed to close observe-only session", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

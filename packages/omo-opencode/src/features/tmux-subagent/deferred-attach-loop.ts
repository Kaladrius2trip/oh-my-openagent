export type DeferredDrainOutcome = "success" | "transient" | "waiting"

export type DeferredAttachLoopState = {
  readonly scheduled: boolean
  readonly draining: boolean
  readonly consecutiveTransientFailures: number
}

export interface DeferredAttachLoop {
  arm: () => void
  stop: () => void
  getState: () => DeferredAttachLoopState
}

export interface DeferredAttachLoopInput<TTimer> {
  readonly normalIntervalMs: number
  readonly hasWork: () => boolean
  readonly drain: () => Promise<DeferredDrainOutcome>
  readonly schedule: (run: () => void, delayMs: number) => TTimer
  readonly cancel: (timer: TTimer) => void
  readonly onError: (error: unknown) => void
}

const TRANSIENT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

export function createDeferredAttachLoop<TTimer>(input: DeferredAttachLoopInput<TTimer>): DeferredAttachLoop {
  let scheduledTimer: TTimer | undefined
  let draining = false
  let enabled = false
  let consecutiveTransientFailures = 0

  function nextTransientDelay(): number {
    const index = Math.min(consecutiveTransientFailures - 1, TRANSIENT_BACKOFF_MS.length - 1)
    return TRANSIENT_BACKOFF_MS[index] ?? TRANSIENT_BACKOFF_MS[TRANSIENT_BACKOFF_MS.length - 1]
  }

  function schedule(delayMs: number): void {
    if (!enabled || scheduledTimer !== undefined || draining || !input.hasWork()) return
    scheduledTimer = input.schedule(() => {
      scheduledTimer = undefined
      if (!enabled || draining || !input.hasWork()) return
      draining = true
      void input.drain()
        .then((outcome) => {
          if (outcome === "transient") {
            consecutiveTransientFailures += 1
          } else if (outcome === "success") {
            consecutiveTransientFailures = 0
          }
        })
        .catch((error: unknown) => {
          consecutiveTransientFailures += 1
          input.onError(error)
        })
        .finally(() => {
          draining = false
          if (!enabled || !input.hasWork()) return
          const delay = consecutiveTransientFailures > 0
            ? nextTransientDelay()
            : input.normalIntervalMs
          schedule(delay)
        })
    }, delayMs)
  }

  return {
    arm: () => {
      enabled = true
      schedule(input.normalIntervalMs)
    },
    stop: () => {
      enabled = false
      consecutiveTransientFailures = 0
      if (scheduledTimer !== undefined) {
        input.cancel(scheduledTimer)
        scheduledTimer = undefined
      }
    },
    getState: () => ({
      scheduled: scheduledTimer !== undefined,
      draining,
      consecutiveTransientFailures,
    }),
  }
}

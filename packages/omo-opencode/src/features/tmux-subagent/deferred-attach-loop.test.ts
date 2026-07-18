import { describe, expect, test } from "bun:test"

import { createDeferredAttachLoop, type DeferredDrainOutcome } from "./deferred-attach-loop"

type ScheduledTimer = {
  readonly id: number
  readonly delayMs: number
  readonly run: () => void
}

function createFakeTimers() {
  let nextId = 1
  const scheduled: ScheduledTimer[] = []
  return {
    scheduled,
    schedule: (run: () => void, delayMs: number) => {
      const timer = { id: nextId, delayMs, run }
      nextId += 1
      scheduled.push(timer)
      return timer.id
    },
    cancel: (id: number) => {
      const index = scheduled.findIndex((timer) => timer.id === id)
      if (index >= 0) scheduled.splice(index, 1)
    },
    fireNext: async () => {
      const timer = scheduled.shift()
      if (!timer) throw new Error("No scheduled timer")
      timer.run()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe("createDeferredAttachLoop", () => {
  test("#given four transient drains then success #when timers fire #then backoff continues, resets, idles, and re-arms", async () => {
    // given
    const timers = createFakeTimers()
    const outcomes: DeferredDrainOutcome[] = ["transient", "transient", "transient", "transient", "success"]
    let hasWork = true
    let spawnCount = 0
    const loop = createDeferredAttachLoop({
      normalIntervalMs: 10_000,
      hasWork: () => hasWork,
      drain: async () => {
        const outcome = outcomes.shift()
        if (!outcome) throw new Error("Missing drain outcome")
        if (outcome === "success") {
          spawnCount += 1
          hasWork = false
        }
        return outcome
      },
      schedule: timers.schedule,
      cancel: timers.cancel,
      onError: () => undefined,
    })

    // when
    loop.arm()
    expect(timers.scheduled.map((timer) => timer.delayMs)).toEqual([10_000])
    await timers.fireNext()
    expect(timers.scheduled.map((timer) => timer.delayMs)).toEqual([1_000])
    await timers.fireNext()
    expect(timers.scheduled.map((timer) => timer.delayMs)).toEqual([2_000])
    await timers.fireNext()
    expect(timers.scheduled.map((timer) => timer.delayMs)).toEqual([5_000])
    await timers.fireNext()
    expect(timers.scheduled.map((timer) => timer.delayMs)).toEqual([10_000])
    await timers.fireNext()

    // then
    expect(spawnCount).toBe(1)
    expect(loop.getState()).toEqual({ scheduled: false, draining: false, consecutiveTransientFailures: 0 })
    expect(timers.scheduled).toHaveLength(0)

    // when
    hasWork = true
    loop.arm()
    loop.arm()

    // then
    expect(timers.scheduled.map((timer) => timer.delayMs)).toEqual([10_000])
  })

  test("#given persistent transient drains #when six retries schedule #then delay caps at thirty seconds", async () => {
    // given
    const timers = createFakeTimers()
    const loop = createDeferredAttachLoop({
      normalIntervalMs: 10_000,
      hasWork: () => true,
      drain: async () => "transient",
      schedule: timers.schedule,
      cancel: timers.cancel,
      onError: () => undefined,
    })
    loop.arm()

    // when
    const observed: number[] = []
    for (let index = 0; index < 6; index += 1) {
      await timers.fireNext()
      const delay = timers.scheduled[0]?.delayMs
      if (delay === undefined) throw new Error("Expected retry timer")
      observed.push(delay)
    }

    // then
    expect(observed).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000])
  })

  test("#given drain is active #when arm is called repeatedly #then no second timer or drain is created", async () => {
    // given
    const timers = createFakeTimers()
    let resolveDrain: ((outcome: DeferredDrainOutcome) => void) | undefined
    const drainPromise = new Promise<DeferredDrainOutcome>((resolve) => {
      resolveDrain = resolve
    })
    const loop = createDeferredAttachLoop({
      normalIntervalMs: 10_000,
      hasWork: () => true,
      drain: () => drainPromise,
      schedule: timers.schedule,
      cancel: timers.cancel,
      onError: () => undefined,
    })
    loop.arm()

    // when
    await timers.fireNext()
    loop.arm()
    loop.arm()

    // then
    expect(loop.getState()).toEqual({ scheduled: false, draining: true, consecutiveTransientFailures: 0 })
    expect(timers.scheduled).toHaveLength(0)

    resolveDrain?.("success")
    await flushMicrotasks()
    expect(timers.scheduled).toHaveLength(1)
  })
})

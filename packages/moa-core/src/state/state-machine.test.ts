import { describe, expect, test } from "bun:test"
import type { MoARunStatus } from "../types"
import {
  assertTransition,
  canTransition,
  computeTerminalStatus,
  isTerminalStatus,
  MOA_TERMINAL_STATUSES,
} from "./state-machine"

describe("isTerminalStatus", () => {
  test("#given each terminal status #when checked #then it is terminal", () => {
    for (const status of MOA_TERMINAL_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true)
    }
  })

  test("#given active statuses #when checked #then they are not terminal", () => {
    const active: MoARunStatus[] = ["created", "resolving", "advising", "aggregating"]
    for (const status of active) {
      expect(isTerminalStatus(status)).toBe(false)
    }
  })
})

describe("canTransition", () => {
  test("#given the happy path #when each step is checked #then transitions are allowed", () => {
    expect(canTransition("created", "resolving")).toBe(true)
    expect(canTransition("resolving", "advising")).toBe(true)
    expect(canTransition("advising", "aggregating")).toBe(true)
    expect(canTransition("aggregating", "completed")).toBe(true)
  })

  test("#given any active status #when cancelled #then the transition is allowed", () => {
    expect(canTransition("created", "cancelled")).toBe(true)
    expect(canTransition("resolving", "cancelled")).toBe(true)
    expect(canTransition("advising", "cancelled")).toBe(true)
    expect(canTransition("aggregating", "cancelled")).toBe(true)
  })

  test("#given a configured diversity failure during resolving #when failing #then the transition is allowed", () => {
    expect(canTransition("resolving", "failed")).toBe(true)
  })

  test("#given below-threshold advisors #when advising ends #then failed and timed_out are allowed without aggregating", () => {
    expect(canTransition("advising", "failed")).toBe(true)
    expect(canTransition("advising", "timed_out")).toBe(true)
  })

  test("#given an illegal jump #when checked #then it is rejected", () => {
    expect(canTransition("created", "aggregating")).toBe(false)
    expect(canTransition("advising", "completed")).toBe(false)
    expect(canTransition("completed", "advising")).toBe(false)
  })
})

describe("assertTransition", () => {
  test("#given an illegal transition #when asserted #then it throws", () => {
    expect(() => assertTransition("completed", "advising")).toThrow()
  })

  test("#given a legal transition #when asserted #then it does not throw", () => {
    expect(() => assertTransition("advising", "aggregating")).not.toThrow()
  })
})

describe("computeTerminalStatus", () => {
  test("#given all advisors succeed and diversity satisfied and aggregator succeeds #when computed #then completed", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: true,
        allAdvisorsSucceeded: true,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: true,
        aggregatorSucceeded: true,
      }),
    ).toBe("completed")
  })

  test("#given partial advisor failure with threshold met #when aggregator succeeds #then degraded", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: true,
        allAdvisorsSucceeded: false,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: true,
        aggregatorSucceeded: true,
      }),
    ).toBe("degraded")
  })

  test("#given effective diversity degraded #when aggregator succeeds #then degraded", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: true,
        allAdvisorsSucceeded: true,
        effectiveDiversity: "degraded",
        aggregatorLaunched: true,
        aggregatorSucceeded: true,
      }),
    ).toBe("degraded")
  })

  test("#given below-threshold advisors #when computed #then failed and aggregator never launches", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: false,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: false,
      }),
    ).toBe("failed")
  })

  test("#given below-threshold advisors due to deadline #when computed #then timed_out", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: false,
        advisorTimedOut: true,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: false,
      }),
    ).toBe("timed_out")
  })

  test("#given effective diversity violated with fail #when computed #then failed and aggregator never launches", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: true,
        effectiveDiversity: "failed",
        aggregatorLaunched: false,
      }),
    ).toBe("failed")
  })

  test("#given aggregator failure with an allowed bundle #when computed #then degraded", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: true,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: true,
        aggregatorSucceeded: false,
        allowDegradedBundle: true,
      }),
    ).toBe("degraded")
  })

  test("#given aggregator failure without an allowed bundle #when computed #then failed", () => {
    expect(
      computeTerminalStatus({
        advisorThresholdMet: true,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: true,
        aggregatorSucceeded: false,
        allowDegradedBundle: false,
      }),
    ).toBe("failed")
  })

  test("#given a parent abort #when computed #then cancelled overrides everything", () => {
    expect(
      computeTerminalStatus({
        cancelled: true,
        advisorThresholdMet: true,
        effectiveDiversity: "satisfied",
        aggregatorLaunched: true,
        aggregatorSucceeded: true,
      }),
    ).toBe("cancelled")
  })
})

import { afterEach, describe, expect, jest, test } from "bun:test"
import type { MoAChildHandle, MoAChildResult, MoAChildWaitTimeouts, ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import type { BackgroundTask } from "../background-agent"
import { createMoAExecutionAdapter } from "./moa-execution-adapter"

const target: ResolvedMoATarget = {
  requested: { category: "moa-architect" },
  agent: "sisyphus-junior",
  category: "moa-architect",
  model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
  fallbackChain: [],
}

const handle: MoAChildHandle = {
  taskId: "bg-activity",
  sessionId: "session-activity",
  role: "advisor",
  slot: "architect",
}

const timeouts: MoAChildWaitTimeouts = {
  baseMs: 150_000,
  idleWindowMs: 60_000,
  maxWallMs: 600_000,
}

type MutableWaitState = {
  status: BackgroundTask["status"]
  lastActivityAt: number | undefined
  continuouslyActive: boolean
}

function createWaitFixture(): {
  readonly state: MutableWaitState
  readonly wait: (signal?: AbortSignal, overrides?: Partial<MoAChildWaitTimeouts>) => Promise<MoAChildResult>
} {
  const state: MutableWaitState = {
    status: "running",
    lastActivityAt: undefined,
    continuouslyActive: false,
  }
  const backgroundManager = {
    launch: async () => ({ id: handle.taskId, sessionId: handle.sessionId }),
    getTask: () => ({ id: handle.taskId, status: state.status, sessionId: handle.sessionId, model: target.model }),
    getTaskLastActivityAt: () => state.continuouslyActive ? Date.now() : state.lastActivityAt,
    readTaskOutput: async () => ({ status: "resolved" as const, output: "advisor report" }),
    cancelTask: async () => true,
  }
  const adapter = createMoAExecutionAdapter({
    backgroundManager,
    parent: { sessionID: "parent-session", messageID: "parent-message" },
    resolveTarget: async () => target,
    pollIntervalMs: 1_000,
  })
  return {
    state,
    wait: (signal = new AbortController().signal, overrides = {}) => adapter.waitForChild(
      handle,
      { ...timeouts, ...overrides },
      signal,
    ),
  }
}

afterEach(() => {
  jest.useRealTimers()
})

describe("MoA activity-aware child timeout", () => {
  test("#given activity ten seconds before base deadline #when child completes during grace #then completed output is preserved", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    const resultPromise = fixture.wait()
    jest.advanceTimersByTime(140_000)
    fixture.state.lastActivityAt = Date.now()

    // when
    jest.advanceTimersByTime(10_000)
    fixture.state.status = "completed"
    jest.advanceTimersByTime(1_000)
    const result = await resultPromise

    // then
    expect(result.status).toBe("completed")
    expect(result.output).toBe("advisor report")
  })

  test("#given activity one hundred twenty seconds before base deadline #when checkpoint arrives #then child times out without extension", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    const startedAt = Date.now()
    const resultPromise = fixture.wait()
    jest.advanceTimersByTime(30_000)
    fixture.state.lastActivityAt = Date.now()

    // when
    jest.advanceTimersByTime(120_000)
    const result = await resultPromise

    // then
    expect(result.status).toBe("timed_out")
    expect(Date.now() - startedAt).toBe(timeouts.baseMs)
  })

  test("#given no recorded activity #when base deadline arrives #then child times out without extension", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    const startedAt = Date.now()
    const resultPromise = fixture.wait()

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    const result = await resultPromise

    // then
    expect(result.status).toBe("timed_out")
    expect(Date.now() - startedAt).toBe(timeouts.baseMs)
  })

  test("#given continuously active child #when repeated grace checkpoints reach hard cap #then wait times out at cap", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    fixture.state.continuouslyActive = true
    const startedAt = Date.now()
    const resultPromise = fixture.wait()
    let settled = false
    void resultPromise.then(() => {
      settled = true
    })

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()
    expect(settled).toBe(false)
    jest.advanceTimersByTime(timeouts.maxWallMs - timeouts.baseMs)
    const result = await resultPromise

    // then
    expect(result.status).toBe("timed_out")
    expect(Date.now() - startedAt).toBe(timeouts.maxWallMs)
  })

  test("#given wait is inside activity grace #when signal aborts #then child cancels immediately", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    const controller = new AbortController()
    const startedAt = Date.now()
    const resultPromise = fixture.wait(controller.signal)
    jest.advanceTimersByTime(140_000)
    fixture.state.lastActivityAt = Date.now()
    jest.advanceTimersByTime(10_000)

    // when
    controller.abort()
    const result = await resultPromise

    // then
    expect(result.status).toBe("cancelled")
    expect(Date.now() - startedAt).toBe(timeouts.baseMs)
  })
})

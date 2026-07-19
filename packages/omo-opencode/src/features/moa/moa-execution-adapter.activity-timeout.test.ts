/// <reference types="bun-types" />

import { afterEach, describe, expect, jest, test } from "bun:test"
import type { MoAChildHandle, MoAChildResult, MoAChildWaitTimeouts, ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import type { BackgroundTask } from "../background-agent"
import type { BackgroundTaskLiveness } from "../background-agent/manager"
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
  liveness: BackgroundTaskLiveness
}

function createWaitFixture(): {
  readonly state: MutableWaitState
  readonly wait: (signal?: AbortSignal, overrides?: Partial<MoAChildWaitTimeouts>) => Promise<MoAChildResult>
} {
  const state: MutableWaitState = {
    status: "running",
    liveness: { kind: "active", sessionID: handle.sessionId!, status: "busy" },
  }
  const backgroundManager = {
    launch: async () => ({ id: handle.taskId, sessionId: handle.sessionId }),
    getTask: () => ({ id: handle.taskId, status: state.status, sessionId: handle.sessionId, model: target.model }),
    getTaskLiveness: async () => state.liveness,
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
  test("#given busy runner with no stream activity #when soft timeout windows pass and child completes #then completed output is preserved", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    const resultPromise = fixture.wait()
    let settled = false
    void resultPromise.then(() => {
      settled = true
    })

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()
    jest.advanceTimersByTime(timeouts.idleWindowMs + 1_000)
    await Promise.resolve()
    expect(settled).toBe(false)
    fixture.state.status = "completed"
    jest.advanceTimersByTime(1_000)
    const result = await resultPromise

    // then
    expect(result.status).toBe("completed")
    expect(result.output).toBe("advisor report")
  })

  test("#given status API failure #when soft timeout windows pass #then task remains pending until hard cap", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    fixture.state.liveness = { kind: "unknown", reason: "status unavailable" }
    const startedAt = Date.now()
    const resultPromise = fixture.wait()
    let settled = false
    void resultPromise.then(() => {
      settled = true
    })

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()
    jest.advanceTimersByTime(timeouts.idleWindowMs + 1_000)
    await Promise.resolve()
    expect(settled).toBe(false)
    jest.advanceTimersByTime(timeouts.maxWallMs - timeouts.baseMs - timeouts.idleWindowMs - 1_000)
    await Promise.resolve()
    const result = await resultPromise

    // then
    expect(result.status).toBe("timed_out")
    expect(Date.now() - startedAt).toBe(timeouts.maxWallMs)
  })

  test("#given quiescent runner #when child completes during inactivity grace #then completion wins", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    fixture.state.liveness = { kind: "quiescent", sessionID: handle.sessionId! }
    const resultPromise = fixture.wait()

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()
    jest.advanceTimersByTime(timeouts.idleWindowMs - 1_000)
    await Promise.resolve()
    fixture.state.status = "completed"
    jest.advanceTimersByTime(1_000)
    const result = await resultPromise

    // then
    expect(result.status).toBe("completed")
    expect(result.output).toBe("advisor report")
  })

  test("#given persistently quiescent runner #when inactivity grace elapses #then task times out", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    fixture.state.liveness = { kind: "quiescent", sessionID: handle.sessionId! }
    const startedAt = Date.now()
    const resultPromise = fixture.wait()

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()
    jest.advanceTimersByTime(timeouts.idleWindowMs)
    await Promise.resolve()
    const result = await resultPromise

    // then
    expect(result.status).toBe("timed_out")
    expect(Date.now() - startedAt).toBe(timeouts.baseMs + timeouts.idleWindowMs)
  })

  test("#given busy runner forever #when hard wall cap arrives #then task times out exactly at cap", async () => {
    jest.useFakeTimers()
    // given
    const fixture = createWaitFixture()
    const startedAt = Date.now()
    const resultPromise = fixture.wait()

    // when
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()
    jest.advanceTimersByTime(timeouts.maxWallMs - timeouts.baseMs)
    await Promise.resolve()
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
    jest.advanceTimersByTime(timeouts.baseMs)
    await Promise.resolve()

    // when
    controller.abort()
    const result = await resultPromise

    // then
    expect(result.status).toBe("cancelled")
    expect(Date.now() - startedAt).toBe(timeouts.baseMs)
  })
})

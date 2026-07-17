import { afterEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { handleAtlasSessionIdle } from "../../hooks/atlas/idle-event"
import { scheduleRetry } from "../../hooks/atlas/idle-continuation"
import { canContinueTrackedBoulderSession } from "../../hooks/atlas/idle-session-eligibility"
import type { SessionState } from "../../hooks/atlas/types"
import { createTeamIdleWakeHint } from "../../hooks/team-session-events/team-idle-wake-hint"
import { handleSessionIdle } from "../../hooks/todo-continuation-enforcer/idle-event"
import type { SessionStateStore } from "../../hooks/todo-continuation-enforcer/session-state"
import { executeBackgroundContinuation } from "../../tools/delegate-task/background-continuation"
import type { ExecutorContext, ParentContext } from "../../tools/delegate-task/executor-types"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "../../tools/delegate-task/types"
import {
  clearContinuationSessionMetadataForTesting,
  getContinuationSessionMetadata,
  isContinuationForbidden,
  setContinuationSessionMetadata,
} from "./continuation-policy"
import { BackgroundManager } from "./manager"
import type { BackgroundTask, ResumeInput } from "./types"

const forbiddenSessionID = "session-forbidden"
const allowedSessionID = "session-allowed"

afterEach(() => {
  clearContinuationSessionMetadataForTesting()
})

function setPolicy(sessionID: string, continuationPolicy: "allow" | "forbid"): void {
  setContinuationSessionMetadata(sessionID, { continuationPolicy })
}

function createResumeInput(sessionId: string): ResumeInput {
  return {
    sessionId,
    prompt: "Continue",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
  }
}

describe("durable continuation policy gates", () => {
  test("given durable metadata when queried then forbid and allow resolve independently", async () => {
    setPolicy(forbiddenSessionID, "forbid")
    setPolicy(allowedSessionID, "allow")

    expect(getContinuationSessionMetadata(forbiddenSessionID)).toEqual({ continuationPolicy: "forbid" })
    expect(isContinuationForbidden(forbiddenSessionID)).toBe(true)
    expect(isContinuationForbidden(allowedSessionID)).toBe(false)
  })

  test("given delegate continuations when executed then forbidden skips resume and allowed proceeds", async () => {
    let resumeCalls = 0
    const manager = {
      resume: async (input: ResumeInput) => {
        resumeCalls += 1
        return {
          id: "bg-continuation",
          sessionId: input.sessionId,
          parentSessionId: input.parentSessionId,
          parentMessageId: input.parentMessageId,
          description: "Continuation",
          prompt: input.prompt,
          agent: "oracle",
          status: "running",
        } satisfies BackgroundTask
      },
    }
    const executor = unsafeTestValue<ExecutorContext>({ manager })
    const ctx = unsafeTestValue<ToolContextWithMetadata>({ sessionID: "parent-session" })
    const parent = unsafeTestValue<ParentContext>({
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "sisyphus",
    })
    const createArgs = (taskID: string) => unsafeTestValue<DelegateTaskArgs>({
      task_id: taskID,
      prompt: "Continue",
      description: "Continuation",
      load_skills: [],
      run_in_background: true,
    })
    setPolicy(forbiddenSessionID, "forbid")

    const denied = await executeBackgroundContinuation(createArgs(forbiddenSessionID), ctx, executor, parent)
    const allowed = await executeBackgroundContinuation(createArgs(allowedSessionID), ctx, executor, parent)

    expect(denied).toContain("continuation is forbidden")
    expect(allowed).toContain("Background task continued")
    expect(resumeCalls).toBe(1)
  })

  test("given todo idle events when handled then forbidden skips reads and allowed proceeds", async () => {
    let messageReads = 0
    const state = { stagnationCount: 0, consecutiveFailures: 0 }
    const store = unsafeTestValue<SessionStateStore>({
      getState: () => state,
      resetContinuationProgress: () => {},
    })
    const ctx = unsafeTestValue<PluginInput>({
      directory: tmpdir(),
      client: { session: {
        messages: async () => { messageReads += 1; return { data: [] } },
        todo: async () => ({ data: [] }),
      } },
    })
    setPolicy(forbiddenSessionID, "forbid")

    await handleSessionIdle({ ctx, sessionID: forbiddenSessionID, sessionStateStore: store })
    await handleSessionIdle({ ctx, sessionID: allowedSessionID, sessionStateStore: store })

    expect(messageReads).toBe(1)
  })

  test("given Atlas idle events when handled then forbidden skips state and allowed proceeds", async () => {
    let stateReads = 0
    const ctx = unsafeTestValue<PluginInput>({ directory: tmpdir(), client: { session: {} } })
    const getState = (): SessionState => { stateReads += 1; return { promptFailureCount: 0 } }
    setPolicy(forbiddenSessionID, "forbid")

    await handleAtlasSessionIdle({ ctx, sessionID: forbiddenSessionID, getState })
    await handleAtlasSessionIdle({ ctx, sessionID: allowedSessionID, getState })

    expect(stateReads).toBe(1)
  })

  test("given Atlas retry scheduling when invoked then forbidden skips timer and allowed proceeds", () => {
    const ctx = unsafeTestValue<PluginInput>({ directory: tmpdir(), client: { session: {} } })
    const forbiddenState: SessionState = { promptFailureCount: 0 }
    const allowedState: SessionState = { promptFailureCount: 0 }
    setPolicy(forbiddenSessionID, "forbid")

    scheduleRetry({ ctx, sessionID: forbiddenSessionID, sessionState: forbiddenState })
    scheduleRetry({ ctx, sessionID: allowedSessionID, sessionState: allowedState })

    expect(forbiddenState.pendingRetryTimer).toBeUndefined()
    expect(allowedState.pendingRetryTimer).toBeDefined()
    if (allowedState.pendingRetryTimer) clearTimeout(allowedState.pendingRetryTimer)
  })

  test("given Atlas session eligibility when checked then forbidden rejects and allowed proceeds", async () => {
    const client = unsafeTestValue<PluginInput["client"]>({ session: {} })
    setPolicy(forbiddenSessionID, "forbid")

    const forbidden = await canContinueTrackedBoulderSession({
      client, sessionID: forbiddenSessionID, sessionOrigin: "direct", boulderSessionIDs: [],
    })
    const allowed = await canContinueTrackedBoulderSession({
      client, sessionID: allowedSessionID, sessionOrigin: "direct", boulderSessionIDs: [],
    })

    expect(forbidden).toBe(false)
    expect(allowed).toBe(true)
  })

  test("given team idle events when handled then forbidden skips resolution and allowed proceeds", async () => {
    let baseDirectoryReads = 0
    const config = unsafeTestValue<TeamModeConfig>({
      get base_dir() { baseDirectoryReads += 1; return tmpdir() },
    })
    const handler = createTeamIdleWakeHint({ directory: tmpdir(), client: { session: {} } }, config)
    const event = (sessionID: string) => ({ event: { type: "session.idle", properties: { sessionID } } })
    setPolicy(forbiddenSessionID, "forbid")

    await handler(event(forbiddenSessionID))
    expect(baseDirectoryReads).toBe(0)
    await handler(event(allowedSessionID))
    expect(baseDirectoryReads).toBeGreaterThan(0)
  })

  test("given BackgroundManager resume when called then forbidden rejects and allowed proceeds", async () => {
    const client = { session: {
      promptAsync: mock(async () => ({ data: {} })),
      abort: mock(async () => ({ data: true })),
    } }
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }),
    })
    const tasks = unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(manager).tasks
    for (const sessionId of [forbiddenSessionID, allowedSessionID]) {
      tasks.set(`bg-${sessionId}`, {
        id: `bg-${sessionId}`, sessionId, parentSessionId: "parent-session",
        parentMessageId: "parent-message", description: "Task", prompt: "Work",
        agent: "oracle", status: "completed",
      })
    }
    setPolicy(forbiddenSessionID, "forbid")

    await expect(manager.resume(createResumeInput(forbiddenSessionID))).rejects.toThrow("continuation is forbidden")
    await expect(manager.resume(createResumeInput(allowedSessionID))).resolves.toMatchObject({ status: "running" })
    manager.shutdown()
  })
})

import { afterEach, describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { clearSessionTools } from "../../shared/session-tools-store"
import type { OpencodeClient, QueueItem } from "./constants"
import { ConcurrencyManager } from "./concurrency"
import { createTask, resumeTask, startTask } from "./spawner"
import type { BackgroundTask, LaunchInput } from "./types"

type PromptRequest = {
  readonly body: {
    readonly tools?: Record<string, boolean>
  }
}

async function waitForPrompt(calls: readonly PromptRequest[]): Promise<void> {
  const deadline = Date.now() + 2_000
  while (calls.length === 0) {
    if (Date.now() >= deadline) throw new Error("prompt dispatch timed out")
    await Bun.sleep(10)
  }
}

function createClient(promptCalls: PromptRequest[], sessionId: string): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
    session: {
      get: async () => ({ data: { directory: "/tmp/test" } }),
      create: async () => ({ data: { id: sessionId } }),
      promptAsync: async (request: PromptRequest) => {
        promptCalls.push(request)
        return { data: {} }
      },
    },
  })
}

afterEach(() => {
  clearSessionTools()
  releaseAllPromptAsyncReservationsForTesting()
})

describe("background-agent spawner capability policy", () => {
  test("given a tool-free launch when dispatched then wildcard denial reaches the child prompt", async () => {
    // given
    const promptCalls: PromptRequest[] = []
    const input: LaunchInput = {
      description: "Consult advisor",
      prompt: "Review the proposal",
      agent: "oracle",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      toolPolicy: "none",
      capabilityProfile: "moa-consultation-only",
    }
    const task = createTask(input)
    const item: QueueItem = { task, input, attemptID: "attempt-1" }

    // when
    await startTask(item, {
      client: createClient(promptCalls, "launch-session"),
      directory: "/tmp/test",
      concurrencyManager: new ConcurrencyManager(),
      tmuxEnabled: false,
      onTaskError: mock(() => {}),
    })
    await waitForPrompt(promptCalls)

    // then
    expect(promptCalls[0]?.body.tools).toEqual({ "*": false })
  })

  test("given a persisted tool-free task when resumed then wildcard denial reaches the child prompt", async () => {
    // given
    const promptCalls: PromptRequest[] = []
    const task: BackgroundTask = {
      id: "tool-free-task",
      sessionId: "resume-session",
      description: "Consult advisor",
      prompt: "Review the proposal",
      agent: "oracle",
      parentSessionId: "old-parent-session",
      parentMessageId: "old-parent-message",
      status: "completed",
      toolPolicy: "none",
      capabilityProfile: "moa-consultation-only",
    }

    // when
    await resumeTask(task, {
      sessionId: "resume-session",
      prompt: "Continue review",
      parentSessionId: "new-parent-session",
      parentMessageId: "new-parent-message",
    }, {
      client: createClient(promptCalls, "unused-session"),
      concurrencyManager: new ConcurrencyManager(),
      directory: "/tmp/test",
      onTaskError: mock(() => {}),
    })
    await waitForPrompt(promptCalls)

    // then
    expect(promptCalls[0]?.body.tools).toEqual({ "*": false })
  })
})

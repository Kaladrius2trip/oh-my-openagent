import { afterEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  _resetTaskToastManagerForTesting,
  initTaskToastManager,
} from "../task-toast-manager/manager"
import type { TaskToastManager } from "../task-toast-manager/manager"
import { BackgroundManager } from "./manager"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"

type SignalCounters = {
  notify: number
  toast: number
  wake: number
}

type ManagerControl = {
  readonly tasks: Map<string, BackgroundTask>
  readonly pendingByParent: Map<string, Set<string>>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  handleSessionErrorEvent: (input: {
    task: BackgroundTask
    errorInfo: { name?: string; message?: string; statusCode?: number }
    errorName?: string
    errorMessage?: string
  }) => Promise<void>
  tryFallbackRetry: (
    task: BackgroundTask,
    errorInfo: { name?: string; message?: string; statusCode?: number },
    source: string,
  ) => Promise<boolean>
  processKey: (key: string) => Promise<void>
  notifyParentSession: (task: BackgroundTask) => Promise<void>
  isSessionActive: (sessionID: string) => Promise<boolean>
  queuePendingParentWake: (
    sessionID: string,
    notification: string,
    promptContext: unknown,
    shouldReply: boolean,
  ) => void
}

const managers: BackgroundManager[] = []

afterEach(() => {
  while (managers.length > 0) managers.pop()?.shutdown()
  _resetTaskToastManagerForTesting()
})

function createTask(id: string, notificationPolicy?: "auto" | "manual"): BackgroundTask {
  return {
    id,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: id,
    prompt: "Review",
    agent: "oracle",
    status: "running",
    startedAt: new Date(),
    notificationPolicy,
    visibility: notificationPolicy === "manual" ? "internal" : "normal",
  }
}

function createToastCounter(): { toastManager: TaskToastManager; getCount: () => number } {
  const toastManager = initTaskToastManager(unsafeTestValue<PluginInput["client"]>({}))
  let count = 0
  const originalAdd = toastManager.addTask.bind(toastManager)
  const originalUpdate = toastManager.updateTask.bind(toastManager)
  const originalRemove = toastManager.removeTask.bind(toastManager)
  const originalComplete = toastManager.showCompletionToast.bind(toastManager)
  toastManager.addTask = (task) => { count += 1; originalAdd(task) }
  toastManager.updateTask = (id, status) => { count += 1; originalUpdate(id, status) }
  toastManager.removeTask = (id) => { count += 1; originalRemove(id) }
  toastManager.showCompletionToast = (task) => { count += 1; originalComplete(task) }
  return { toastManager, getCount: () => count }
}

function createManager(): BackgroundManager {
  const directory = tmpdir()
  const client = {
    session: {
      messages: mock(async () => ({ data: [] })),
      abort: mock(async () => ({ data: true })),
      promptAsync: mock(async () => ({ data: {} })),
      get: mock(async ({ path }: { path: { id: string } }) => ({
        data: { id: path.id, directory },
      })),
      create: mock(async () => ({ data: { id: `child-${crypto.randomUUID()}` } })),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({ client, directory }),
  })
  managers.push(manager)
  return manager
}

async function runTerminalAndRetrySignals(
  notificationPolicy?: "auto" | "manual",
): Promise<SignalCounters> {
  const { getCount } = createToastCounter()
  const manager = createManager()
  const control = unsafeTestValue<ManagerControl>(manager)
  const counters: SignalCounters = { notify: 0, toast: 0, wake: 0 }
  const originalNotify = control.notifyParentSession.bind(manager)
  control.notifyParentSession = async (task) => {
    counters.notify += 1
    await originalNotify(task)
  }
  control.queuePendingParentWake = () => { counters.wake += 1 }
  control.processKey = async () => {}

  const completed = createTask("complete", notificationPolicy)
  const errored = createTask("error", notificationPolicy)
  const cancelled = createTask("cancel", notificationPolicy)
  const retrying = {
    ...createTask("retry", notificationPolicy),
    model: { providerID: "anthropic", modelID: "primary-model" },
    fallbackChain: [{ model: "fallback-model", providers: ["openai"] }],
    attemptCount: 0,
  } satisfies BackgroundTask
  for (const task of [completed, errored, cancelled, retrying]) {
    control.tasks.set(task.id, task)
  }

  await control.tryCompleteTask(completed, "test")
  await control.handleSessionErrorEvent({
    task: errored,
    errorInfo: { name: "TerminalError", message: "terminal" },
    errorName: "TerminalError",
    errorMessage: "terminal",
  })
  await manager.cancelTask(cancelled.id, { abortSession: false, source: "test" })
  expect(await control.tryFallbackRetry(
    retrying,
    { name: "RateLimitError", message: "rate limited", statusCode: 429 },
    "test",
  )).toBe(true)

  counters.toast = getCount()
  return counters
}

describe("background task notification suppression", () => {
  test("given an internal manual task when terminal and retry paths run then all parent signals stay zero", async () => {
    const counters = await runTerminalAndRetrySignals("manual")

    expect(counters).toEqual({ notify: 0, toast: 0, wake: 0 })
  })

  test("given normal tasks when terminal and retry paths run then existing signal counts remain pinned", async () => {
    const counters = await runTerminalAndRetrySignals()

    expect(counters).toEqual({ notify: 3, toast: 6, wake: 4 })
  })

  test("given a normal completion beside internal work when notifying then internal work does not delay all-complete", async () => {
    const manager = createManager()
    const control = unsafeTestValue<ManagerControl>(manager)
    const normalTask = { ...createTask("normal-sibling"), status: "completed" } satisfies BackgroundTask
    const internalTask = createTask("internal-sibling", "manual")
    control.tasks.set(normalTask.id, normalTask)
    control.tasks.set(internalTask.id, internalTask)
    control.pendingByParent.set(normalTask.parentSessionId, new Set([normalTask.id, internalTask.id]))
    control.isSessionActive = async () => true
    let shouldReply = false
    control.queuePendingParentWake = (_sessionID, _notification, _promptContext, reply) => {
      shouldReply = reply
    }

    await control.notifyParentSession(normalTask)

    expect(shouldReply).toBe(true)
  })

  test("given manual and normal launches when started then only normal launch toasts are tracked", async () => {
    const { getCount } = createToastCounter()
    const manager = createManager()
    const createInput = (description: string, notificationPolicy?: "auto" | "manual"): LaunchInput => ({
      description,
      prompt: "Review",
      agent: "oracle",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      notificationPolicy,
      visibility: notificationPolicy === "manual" ? "internal" : "normal",
    })

    await manager.launch(createInput("manual", "manual"))
    await manager.launch(createInput("normal"))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(getCount()).toBe(2)
  })

  test("given manual and normal resumes when started then only normal resume toast is tracked", async () => {
    const { toastManager } = createToastCounter()
    let addCalls = 0
    const originalAdd = toastManager.addTask.bind(toastManager)
    toastManager.addTask = (task) => { addCalls += 1; originalAdd(task) }
    const manager = createManager()
    const tasks = unsafeTestValue<ManagerControl>(manager).tasks
    for (const [sessionId, notificationPolicy] of [["manual-session", "manual"], ["normal-session", "auto"]] as const) {
      tasks.set(`bg-${sessionId}`, {
        ...createTask(`bg-${sessionId}`, notificationPolicy),
        sessionId,
        status: "completed",
      })
    }
    const resume = (sessionId: string): ResumeInput => ({
      sessionId,
      prompt: "Continue",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
    })

    await manager.resume(resume("manual-session"))
    await manager.resume(resume("normal-session"))

    expect(addCalls).toBe(1)
  })
})

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import {
  clearContinuationSessionMetadata,
  isContinuationForbidden,
} from "../../../packages/omo-opencode/src/features/background-agent/continuation-policy"
import { BackgroundManager } from "../../../packages/omo-opencode/src/features/background-agent/manager"
import type {
  BackgroundTask,
  LaunchInput,
} from "../../../packages/omo-opencode/src/features/background-agent/types"
import {
  _resetTaskToastManagerForTesting,
  initTaskToastManager,
} from "../../../packages/omo-opencode/src/features/task-toast-manager/manager"
import { buildTuiRuntimeSnapshot } from "../../../packages/omo-opencode/src/features/tui-sidebar/snapshot-builder"

type PromptBody = {
  readonly tools?: Record<string, boolean>
}

type ManagerControl = {
  notifyParentSession: (task: BackgroundTask) => Promise<void>
  publishTaskNotification: (task: BackgroundTask) => Promise<void>
  queuePendingParentWake: (
    sessionID: string,
    notification: string,
    promptContext: unknown,
    shouldReply: boolean,
  ) => void
}

const controls = {
  visibility: "internal",
  notificationPolicy: "manual",
  continuationPolicy: "forbid",
  toolPolicy: "none",
  capabilityProfile: "moa-consultation-only",
  orchestration: {
    kind: "moa",
    runId: "qa-run",
    role: "advisor",
    slot: "qa",
  },
} as const satisfies Pick<
  LaunchInput,
  | "visibility"
  | "notificationPolicy"
  | "continuationPolicy"
  | "toolPolicy"
  | "capabilityProfile"
  | "orchestration"
>

const projectDirectory = mkdtempSync(join(tmpdir(), "moa-pr1-controls-"))
const parentSessionID = "parent-all-controls"
const childSessionID = "child-all-controls"
const originalTmux = process.env.TMUX
let manager: BackgroundManager | undefined

try {
  process.env.TMUX = "/tmp/moa-pr1-controls-tmux"
  const signals = { notify: 0, toast: 0, wake: 0, tmux: 0 }
  let resolvePrompt: (body: PromptBody) => void = () => {}
  const promptDispatched = new Promise<PromptBody>((resolve) => {
    resolvePrompt = resolve
  })

  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({
        data: { id: path.id, directory: projectDirectory },
      }),
      create: async () => ({ data: { id: childSessionID } }),
      promptAsync: async ({ body }: { body: PromptBody }) => {
        resolvePrompt(body)
        return { data: {} }
      },
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }

  const toastManager = initTaskToastManager(unsafeTestValue<PluginInput["client"]>(client))
  toastManager.addTask = () => { signals.toast += 1 }
  toastManager.updateTask = () => { signals.toast += 1 }
  toastManager.removeTask = () => { signals.toast += 1 }
  toastManager.showCompletionToast = () => { signals.toast += 1 }

  manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({
      client,
      directory: projectDirectory,
    }),
    tmuxConfig: {
      enabled: true,
      layout: "main-vertical",
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40,
      isolation: "inline",
    },
    onSubagentSessionCreated: async () => {
      signals.tmux += 1
    },
  })
  const managerControl = unsafeTestValue<ManagerControl>(manager)
  managerControl.notifyParentSession = async () => {
    signals.notify += 1
  }
  managerControl.queuePendingParentWake = () => {
    signals.wake += 1
  }

  const launched = await manager.launch({
    ...controls,
    description: "All-six control acceptance",
    prompt: "Review without tools",
    agent: "oracle",
    parentSessionId: parentSessionID,
    parentMessageId: "parent-message",
  })

  let diagnosticTimeout: ReturnType<typeof setTimeout> | undefined
  let promptBody: PromptBody
  try {
    promptBody = await Promise.race([
      promptDispatched,
      new Promise<never>((_resolve, reject) => {
        diagnosticTimeout = setTimeout(
          () => reject(new Error("Timed out waiting for manager prompt dispatch")),
          1_000,
        )
      }),
    ])
  } finally {
    if (diagnosticTimeout !== undefined) clearTimeout(diagnosticTimeout)
  }

  const persistedTask = manager.getTask(launched.id)
  if (!persistedTask) throw new Error("Manager did not retain the launched task")
  await managerControl.publishTaskNotification(persistedTask)

  const sidebar = await buildTuiRuntimeSnapshot({
    projectDir: projectDirectory,
    client: unsafeTestValue({ session: client.session }),
    backgroundManager: manager,
    getStatuses: async () => ({}),
  })

  const result = {
    controls,
    signals,
    visibility: {
      publicSnapshotRows: manager.getTasksSnapshot().length,
      sidebarRows: sidebar.jobBoard.length,
      internalSnapshotRows: manager.getTasksSnapshotIncludingInternal().length,
    },
    promptToolCount: Object.keys(promptBody.tools ?? {}).length,
    continuationForbidden: isContinuationForbidden(childSessionID),
    parentSessionIdPreserved: persistedTask.parentSessionId === parentSessionID,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  manager?.shutdown()
  _resetTaskToastManagerForTesting()
  clearContinuationSessionMetadata(childSessionID)
  rmSync(projectDirectory, { recursive: true, force: true })
  if (originalTmux === undefined) delete process.env.TMUX
  else process.env.TMUX = originalTmux
}

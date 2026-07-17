import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { MoAConfig, MoATarget } from "@oh-my-opencode/moa-core"
import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import {
  clearContinuationSessionMetadata,
  isContinuationForbidden,
} from "../../../packages/omo-opencode/src/features/background-agent/continuation-policy"
import { BackgroundManager } from "../../../packages/omo-opencode/src/features/background-agent/manager"
import type { BackgroundTask } from "../../../packages/omo-opencode/src/features/background-agent/types"
import { createMoAExecutionAdapter } from "../../../packages/omo-opencode/src/features/moa/moa-execution-adapter"
import { createMoAManager } from "../../../packages/omo-opencode/src/features/moa/moa-manager"
import {
  _resetTaskToastManagerForTesting,
  initTaskToastManager,
} from "../../../packages/omo-opencode/src/features/task-toast-manager/manager"
import { buildTuiRuntimeSnapshot } from "../../../packages/omo-opencode/src/features/tui-sidebar/snapshot-builder"

interface PromptBody {
  readonly tools?: Readonly<Record<string, boolean>>
}

interface PromptCall {
  readonly sessionID: string
  readonly body: PromptBody
}

interface SessionCreateCall {
  readonly parentID?: string
}

interface ManagerControl {
  readonly tasks: Map<string, BackgroundTask>
  publishTaskNotification(task: BackgroundTask): Promise<void>
  notifyParentSession(task: BackgroundTask): Promise<void>
  queuePendingParentWake(
    sessionID: string,
    notification: string,
    promptContext: unknown,
    shouldReply: boolean,
  ): void
}

const parentSessionID = "parent-moa-qa"
const projectDirectory = mkdtempSync(join(tmpdir(), "moa-pr3-manager-"))
const signals = { notify: 0, toast: 0, wake: 0, tmux: 0 }
const promptCalls: PromptCall[] = []
const sessionCreateCalls: SessionCreateCall[] = []
const childSessionIDs: string[] = []
let manager: BackgroundManager | undefined

const targets: Readonly<Record<string, Omit<ResolvedMoATarget, "requested">>> = {
  "qa-anthropic": {
    agent: "oracle",
    category: "qa-anthropic",
    model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
    fallbackChain: [],
  },
  "qa-openai": {
    agent: "oracle",
    category: "qa-openai",
    model: { providerID: "openai", modelID: "gpt-5.5" },
    fallbackChain: [],
  },
  "qa-google": {
    agent: "oracle",
    category: "qa-google",
    model: { providerID: "google", modelID: "gemini-3.1-pro" },
    fallbackChain: [],
  },
}

function resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
  if (!("category" in target)) throw new Error("QA only defines category targets")
  const resolved = targets[target.category]
  if (resolved === undefined) throw new Error(`Unknown QA target: ${target.category}`)
  return Promise.resolve({ requested: target, ...resolved })
}

const config: MoAConfig = {
  enabled: true,
  default_preset: "qa",
  max_advisors_per_run: 2,
  presets: {
    qa: {
      execution_policy: "consultation_only",
      advisors: [
        { name: "architect", role: "architect", category: "qa-anthropic", tool_policy: "none" },
        { name: "challenger", role: "challenger", category: "qa-openai", tool_policy: "none" },
      ],
      aggregator: { category: "qa-google" },
      diversity: {
        min_distinct_providers: 2,
        min_distinct_models: 2,
        on_configured_violation: "fail",
        on_effective_violation: "fail",
      },
      min_successful_advisors: 2,
      advisor_timeout_ms: 2_000,
      aggregator_timeout_ms: 2_000,
    },
  },
}

try {
  let managerControl: ManagerControl | undefined
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({
        data: { id: path.id, directory: projectDirectory },
      }),
      create: async ({ body }: { body: SessionCreateCall }) => {
        sessionCreateCalls.push(body)
        const id = `child-moa-${sessionCreateCalls.length}`
        childSessionIDs.push(id)
        return { data: { id } }
      },
      promptAsync: async ({ path, body }: { path: { id: string }; body: PromptBody }) => {
        promptCalls.push({ sessionID: path.id, body })
        const task = [...(managerControl?.tasks.values() ?? [])]
          .find((candidate) => candidate.sessionId === path.id)
        if (task === undefined) throw new Error(`No task for prompted session ${path.id}`)
        task.status = "completed"
        task.completedAt = new Date()
        task.result = task.orchestration?.role === "aggregator"
          ? "QA synthesis from one aggregator"
          : `QA report from ${task.orchestration?.slot ?? "advisor"}`
        const attempt = task.attempts?.find((candidate) => candidate.attemptId === task.currentAttemptID)
        if (attempt !== undefined) {
          attempt.status = "completed"
          attempt.completedAt = task.completedAt
        }
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

  const backgroundManager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({ client, directory: projectDirectory }),
    tmuxConfig: {
      enabled: true,
      layout: "main-vertical",
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40,
      isolation: "inline",
    },
    onSubagentSessionCreated: async () => { signals.tmux += 1 },
  })
  manager = backgroundManager
  managerControl = unsafeTestValue<ManagerControl>(backgroundManager)
  managerControl.notifyParentSession = async () => { signals.notify += 1 }
  managerControl.queuePendingParentWake = () => { signals.wake += 1 }

  const moaManager = createMoAManager({
    config,
    createRunId: () => "qa-run",
    createAdapter: (parent) => createMoAExecutionAdapter({
      backgroundManager,
      parent,
      resolveTarget,
      pollIntervalMs: 1,
    }),
  })
  const runResult = await moaManager.run(
    { prompt: "Evaluate the PR3 adapter acceptance path." },
    {
      sessionID: parentSessionID,
      messageID: "parent-message",
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
    },
  )

  const tasks = [...managerControl.tasks.values()]
  for (const task of tasks) await managerControl.publishTaskNotification(task)
  const sidebar = await buildTuiRuntimeSnapshot({
    projectDir: projectDirectory,
    client: unsafeTestValue({ session: client.session }),
    backgroundManager,
    getStatuses: async () => ({}),
  })
  const roles = tasks.map((task) => task.orchestration?.role)
  const assertions = {
    completedRun: runResult.status === "completed",
    oneSynthesis: runResult.synthesis === "QA synthesis from one aggregator",
    twoAdvisors: roles.filter((role) => role === "advisor").length === 2,
    oneAggregator: roles.filter((role) => role === "aggregator").length === 1,
    allChildrenInternal: tasks.every((task) => task.visibility === "internal"),
    allChildrenManual: tasks.every((task) => task.notificationPolicy === "manual"),
    allChildrenToolless: tasks.every((task) => task.toolPolicy === "none")
      && promptCalls.every((call) => Object.keys(call.body.tools ?? {}).length === 0),
    allChildrenForbidContinuation: tasks.every((task) => task.continuationPolicy === "forbid")
      && childSessionIDs.every(isContinuationForbidden),
    allChildrenSuppressTmux: tasks.every((task) => task.suppressTmuxSpawn === true),
    allChildrenConsultationOnly: tasks.every((task) => task.capabilityProfile === "moa-consultation-only"),
    allChildrenTerminal: tasks.every((task) => task.status === "completed"),
    parentLineagePreserved: tasks.every((task) => task.parentSessionId === parentSessionID)
      && sessionCreateCalls.every((call) => call.parentID === parentSessionID),
    zeroParentPromptCalls: promptCalls.every((call) => call.sessionID !== parentSessionID),
    zeroPublicRows: backgroundManager.getTasksSnapshot().length === 0,
    zeroSidebarRows: sidebar.jobBoard.length === 0,
    zeroSignals: Object.values(signals).every((count) => count === 0),
  }
  const failedAssertions = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  process.stdout.write(`${JSON.stringify({
    run: runResult,
    assertions,
    failedAssertions,
    taskCount: tasks.length,
    childSessionIDs,
    promptSessionIDs: promptCalls.map((call) => call.sessionID),
    signals,
    visibility: {
      publicSnapshotRows: backgroundManager.getTasksSnapshot().length,
      sidebarRows: sidebar.jobBoard.length,
      internalSnapshotRows: backgroundManager.getTasksSnapshotIncludingInternal().length,
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      sessionId: task.sessionId,
      status: task.status,
      parentSessionId: task.parentSessionId,
      controls: {
        visibility: task.visibility,
        notificationPolicy: task.notificationPolicy,
        suppressTmuxSpawn: task.suppressTmuxSpawn,
        toolPolicy: task.toolPolicy,
        capabilityProfile: task.capabilityProfile,
        continuationPolicy: task.continuationPolicy,
      },
      orchestration: task.orchestration,
    })),
  }, null, 2)}\n`)
  if (failedAssertions.length > 0) throw new Error(`QA assertions failed: ${failedAssertions.join(", ")}`)
  await moaManager.shutdown()
} finally {
  manager?.shutdown()
  _resetTaskToastManagerForTesting()
  for (const sessionID of childSessionIDs) clearContinuationSessionMetadata(sessionID)
  rmSync(projectDirectory, { recursive: true, force: true })
}

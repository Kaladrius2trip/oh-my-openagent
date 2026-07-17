import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  clearContinuationSessionMetadata,
  getContinuationSessionMetadata,
} from "./continuation-policy"
import { BackgroundManager } from "./manager"
import { buildTaskRecord } from "./spawner/task-record"
import type { BackgroundTaskPolicyFields, LaunchInput } from "./types"

const managers: BackgroundManager[] = []

const controls = {
  visibility: "internal",
  notificationPolicy: "manual",
  continuationPolicy: "forbid",
  toolPolicy: "none",
  capabilityProfile: "moa-consultation-only",
  orchestration: {
    kind: "moa",
    runId: "run-policy",
    role: "advisor",
    slot: "security",
  },
} as const satisfies BackgroundTaskPolicyFields

afterEach(() => {
  while (managers.length > 0) {
    managers.pop()?.shutdown()
  }
  clearContinuationSessionMetadata("child-policy-session")
})

function createLaunchInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    description: "Consult an advisor",
    prompt: "Review the proposal",
    agent: "oracle",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    ...controls,
    ...overrides,
  }
}

function createBackgroundManager(): BackgroundManager {
  const directory = tmpdir()
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({
        data: { id: path.id, directory },
      }),
      create: async () => ({ data: { id: "child-policy-session" } }),
      promptAsync: async () => ({ data: {} }),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({ client, directory }),
  })
  managers.push(manager)
  return manager
}

describe("background task policy persistence", () => {
  describe("given a launch input with every control", () => {
    test("when buildTaskRecord runs then it preserves the controls and parent lineage", () => {
      const input = createLaunchInput()

      const task = buildTaskRecord(input, "bg-record", new Date(0))

      expect(task).toMatchObject({
        ...controls,
        parentSessionId: "parent-session",
      })
    })

    test("when BackgroundManager creates the child then task and session metadata preserve policy", async () => {
      const manager = createBackgroundManager()
      let resolveSessionCreated: (sessionID: string) => void = () => {}
      const sessionCreated = new Promise<string>((resolve) => {
        resolveSessionCreated = resolve
      })

      const launched = await manager.launch(createLaunchInput({
        onSessionCreated: resolveSessionCreated,
      }))
      const sessionID = await sessionCreated
      const persisted = manager.getTask(launched.id)

      expect(persisted).toMatchObject({
        ...controls,
        parentSessionId: "parent-session",
      })
      expect(getContinuationSessionMetadata(sessionID)).toEqual({
        continuationPolicy: "forbid",
      })
    })
  })
})

import { describe, expect, test } from "bun:test"
import {
  resolveBackgroundTaskPolicies,
  type BackgroundTask,
  type LaunchInput,
} from "./types"

function createLaunchInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    description: "Consult advisors",
    prompt: "Review the proposed change",
    agent: "oracle",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    ...overrides,
  }
}

function createBackgroundTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg-policy",
    description: "Consult advisors",
    prompt: "Review the proposed change",
    agent: "oracle",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    status: "pending",
    ...overrides,
  }
}

describe("background task policy fields", () => {
  describe("given no explicit controls", () => {
    test("when policies are resolved then current behavior remains the default", () => {
      const input = createLaunchInput()

      const resolved = resolveBackgroundTaskPolicies(input)

      expect(resolved).toEqual({
        visibility: "normal",
        notificationPolicy: "auto",
        continuationPolicy: "allow",
        toolPolicy: "default",
      })
    })
  })

  describe("given all controls", () => {
    test("when launch and task records are constructed then both accept the fields", () => {
      const controls = {
        visibility: "internal",
        notificationPolicy: "manual",
        continuationPolicy: "forbid",
        toolPolicy: "none",
        capabilityProfile: "moa-consultation-only",
        orchestration: {
          kind: "moa",
          runId: "run-1",
          role: "advisor",
          slot: "architecture",
        },
      } as const

      const input: LaunchInput = createLaunchInput(controls)
      const task: BackgroundTask = createBackgroundTask(controls)

      expect(resolveBackgroundTaskPolicies(input)).toEqual(controls)
      expect(resolveBackgroundTaskPolicies(task)).toEqual(controls)
    })
  })
})

import { describe, expect, test } from "bun:test"
import type { MoAChildLaunchInput, ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import type { LaunchInput } from "../background-agent"

import { createMoAExecutionAdapter } from "./moa-execution-adapter"

const target: ResolvedMoATarget = {
  requested: { category: "moa-architect" },
  agent: "sisyphus-junior",
  category: "moa-architect",
  model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
  fallbackChain: [{ providerID: "openai", modelID: "gpt-5.5", reasoningEffort: "high" }],
}

function childInput(role: "advisor" | "aggregator", slot?: string): MoAChildLaunchInput {
  return {
    role,
    target,
    prompt: `${role} prompt`,
    visibility: "internal",
    notificationPolicy: "manual",
    suppressTmuxSpawn: true,
    toolPolicy: "none",
    capabilityProfile: "moa-consultation-only",
    continuationPolicy: "forbid",
    orchestration: {
      kind: "moa",
      runId: "run-1",
      role,
      ...(slot !== undefined ? { slot } : {}),
    },
  }
}

describe("createMoAExecutionAdapter", () => {
  test("#given advisor and aggregator launches #when adapter launches both #then every child carries all controls, orchestration, and parent lineage", async () => {
    // given
    const launches: LaunchInput[] = []
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          launches.push(input)
          return { id: `bg-${launches.length}`, sessionId: `session-${launches.length}` }
        },
        getTask: () => undefined,
        readTaskOutput: async () => ({ status: "failed", reason: "task_missing" }),
        cancelTask: async () => true,
      },
      parent: {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      },
      resolveTarget: async () => target,
    })

    // when
    await Promise.all([
      adapter.launchChild(childInput("advisor", "architect")),
      adapter.launchChild(childInput("aggregator")),
    ])

    // then
    expect(launches).toHaveLength(2)
    for (const launch of launches) {
      expect(launch).toMatchObject({
        visibility: "internal",
        notificationPolicy: "manual",
        suppressTmuxSpawn: true,
        toolPolicy: "none",
        capabilityProfile: "moa-consultation-only",
        continuationPolicy: "forbid",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      })
      expect(launch.orchestration?.kind).toBe("moa")
    }
    expect(launches[0]?.orchestration).toEqual({
      kind: "moa",
      runId: "run-1",
      role: "advisor",
      slot: "architect",
    })
    expect(launches[1]?.orchestration).toEqual({
      kind: "moa",
      runId: "run-1",
      role: "aggregator",
    })
    expect(launches[0]?.fallbackChain).toEqual([
      { providers: ["openai"], model: "gpt-5.5", reasoningEffort: "high" },
    ])
  })

  test("#given a direct slot temperature #when adapter launches #then it overrides the target and every fallback", async () => {
    // given
    const launches: LaunchInput[] = []
    const temperatureTarget: ResolvedMoATarget = {
      ...target,
      model: { ...target.model, temperature: 0.3 },
      fallbackChain: [
        { providerID: "openai", modelID: "gpt-5.5", temperature: 0.4 },
        { providerID: "google", modelID: "gemini-3.1-pro", temperature: 0.6 },
      ],
    }
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async (input) => {
          launches.push(input)
          return { id: "bg-1" }
        },
        getTask: () => undefined,
        readTaskOutput: async () => ({ status: "failed", reason: "task_missing" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => temperatureTarget,
    })

    // when
    await adapter.launchChild({
      ...childInput("advisor", "architect"),
      target: temperatureTarget,
      temperature: 0.8,
    })

    // then
    expect(launches[0]?.model?.temperature).toBe(0.8)
    expect(launches[0]?.fallbackChain).toEqual([
      { providers: ["openai"], model: "gpt-5.5", temperature: 0.8 },
      { providers: ["google"], model: "gemini-3.1-pro", temperature: 0.8 },
    ])
  })

  test("#given a completed fallback task #when adapter waits #then result reports output and final settled model", async () => {
    // given
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async () => ({ id: "bg-1", sessionId: "child-session" }),
        getTask: () => ({
          id: "bg-1",
          status: "completed",
          sessionId: "child-session",
          model: target.model,
          attemptCount: 1,
          attempts: [{
            attemptId: "attempt-2",
            attemptNumber: 2,
            providerId: "openai",
            modelId: "gpt-5.5",
            status: "completed",
          }],
        }),
        readTaskOutput: async () => ({ status: "resolved", output: "advisor report" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      pollIntervalMs: 1,
    })

    // when
    const result = await adapter.waitForChild({
      taskId: "bg-1",
      sessionId: "child-session",
      role: "advisor",
      slot: "architect",
    }, 100, new AbortController().signal)

    // then
    expect(result.status).toBe("completed")
    expect(result.output).toBe("advisor report")
    expect(result.finalModel).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
    expect(result.fallbackCount).toBe(1)
  })

  test("#given completed task without resolvable text #when adapter waits #then result fails closed", async () => {
    // given
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async () => ({ id: "bg-1", sessionId: "child-session" }),
        getTask: () => ({
          id: "bg-1",
          status: "completed",
          sessionId: "child-session",
          model: target.model,
        }),
        readTaskOutput: async () => ({ status: "failed", reason: "assistant_text_missing" }),
        cancelTask: async () => true,
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
      pollIntervalMs: 1,
    })

    // when
    const result = await adapter.waitForChild({
      taskId: "bg-1",
      sessionId: "child-session",
      role: "advisor",
      slot: "architect",
    }, 100, new AbortController().signal)

    // then
    expect(result.status).toBe("failed")
    expect(result.output).toBeUndefined()
    expect(result.errorCategory).toBe("output_resolution_failed")
  })

  test("#given an active child #when adapter cancels it #then BackgroundManager receives silent MoA cancellation", async () => {
    // given
    const cancellations: Array<{ taskId: string; reason?: string; skipNotification?: boolean }> = []
    const adapter = createMoAExecutionAdapter({
      backgroundManager: {
        launch: async () => ({ id: "bg-1" }),
        getTask: () => undefined,
        readTaskOutput: async () => ({ status: "failed", reason: "task_missing" }),
        cancelTask: async (taskId, options) => {
          cancellations.push({ taskId, reason: options?.reason, skipNotification: options?.skipNotification })
          return true
        },
      },
      parent: { sessionID: "parent-session", messageID: "parent-message" },
      resolveTarget: async () => target,
    })

    // when
    await adapter.cancelChild({ taskId: "bg-1", role: "advisor", slot: "architect" }, "parent cancelled")

    // then
    expect(cancellations).toEqual([{ taskId: "bg-1", reason: "parent cancelled", skipNotification: true }])
  })
})

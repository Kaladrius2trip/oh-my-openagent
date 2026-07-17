import { describe, expect, test } from "bun:test"
import type { MoAChildResult, MoAChildStatus, MoAConfig, MoADiversityCheck } from "@oh-my-opencode/moa-core"

import type { MoAManager, MoAParentContext, MoARunRequest, MoARunResult } from "../../features/moa"
import { createMoaConsultTool } from "./tool"

function advisor(status: MoAChildStatus): MoAChildResult {
  return {
    handle: { taskId: `task-${status}`, role: "advisor" },
    status,
    finalModel: { providerID: "anthropic", modelID: "claude-opus-4-7" },
    fallbackCount: 0,
  }
}

function diversity(outcome: MoADiversityCheck["outcome"], providers: number, models: number): MoADiversityCheck {
  return {
    counts: { providers, models },
    meetsProviders: true,
    meetsModels: true,
    satisfied: outcome === "satisfied",
    policy: "fail",
    outcome,
  }
}

const COMPLETED_RUN: MoARunResult = {
  runId: "run-1",
  status: "completed",
  synthesis: "## Decision\nProceed with the split.",
  advisorResults: [advisor("completed"), advisor("completed"), advisor("failed")],
  configuredDiversity: diversity("satisfied", 3, 3),
  effectiveDiversity: diversity("degraded", 2, 2),
}

interface FakeManager {
  readonly manager: MoAManager
  readonly requests: MoARunRequest[]
}

function createFakeManager(makeResult: (request: MoARunRequest) => MoARunResult = () => COMPLETED_RUN): FakeManager {
  const requests: MoARunRequest[] = []
  const manager: MoAManager = {
    async run(request: MoARunRequest, _context: MoAParentContext): Promise<MoARunResult> {
      requests.push(request)
      return makeResult(request)
    },
    async cancel() {
      return true
    },
    getRun() {
      return undefined
    },
    async shutdown() {},
  }
  return { manager, requests }
}

const config: MoAConfig = { enabled: true, default_preset: "architecture-balanced", max_advisors_per_run: 8 }

const context = {
  sessionID: "ses-1",
  messageID: "msg-1",
  agent: "sisyphus",
  directory: "/tmp/moa",
  worktree: "/tmp/moa",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

describe("createMoaConsultTool", () => {
  test("maps a completed run to the consultation contract using the default preset", async () => {
    // Given a manager that returns a completed run
    const { manager, requests } = createFakeManager()
    const moaTool = createMoaConsultTool(manager, config)

    // When the tool runs with only a prompt
    const result = await moaTool.execute({ prompt: "Should we split module X?" }, context)

    // Then it returns the consultation bundle with zero tools exposed and parent authority
    if (typeof result === "string") throw new Error(`expected a structured result, got: ${result}`)
    const bundle = result.metadata
    expect(bundle?.runId).toBe("run-1")
    expect(bundle?.preset).toBe("architecture-balanced")
    expect(bundle?.status).toBe("completed")
    expect(bundle?.synthesis).toBe("## Decision\nProceed with the split.")
    expect(bundle?.execution).toEqual({
      policy: "consultation_only",
      toolsExposed: 0,
      mutationsPerformed: 0,
      implementationAuthority: "parent",
    })
    expect(bundle?.advisorSummary).toEqual({ requested: 3, successful: 2, failed: 1, timedOut: 0 })
    expect(bundle?.diversity).toEqual({
      configuredProviders: 3,
      effectiveProviders: 2,
      configuredModels: 3,
      effectiveModels: 2,
      outcome: "degraded",
    })

    // And the run used the resolved default preset
    expect(requests[0]?.preset).toBe("architecture-balanced")
  })

  test("passes an explicitly requested preset through to the manager", async () => {
    // Given a manager and a config with only builtin presets
    const { manager, requests } = createFakeManager()
    const moaTool = createMoaConsultTool(manager, { ...config, presets: {} })

    // When the tool runs with an explicit preset
    await moaTool.execute({ prompt: "review", preset: "security-critical" }, context)

    // Then the manager receives that preset
    expect(requests[0]?.preset).toBe("security-critical")
  })

  test("rejects an unknown preset without starting a run", async () => {
    // Given a manager whose run must never be called
    const { manager, requests } = createFakeManager()
    const moaTool = createMoaConsultTool(manager, config)

    // When the tool runs with an unknown preset
    const result = await moaTool.execute({ prompt: "x", preset: "does-not-exist" }, context)

    // Then it returns a tool error naming the preset and starts no run
    expect(typeof result).toBe("string")
    if (typeof result !== "string") throw new Error("expected a string error")
    expect(result).toContain("does-not-exist")
    expect(requests).toHaveLength(0)
  })

  test("surfaces the run error in warnings when the run fails", async () => {
    // Given a manager that returns a failed run with an error and no aggregator synthesis
    const failedRun: MoARunResult = {
      runId: "run-2",
      status: "failed",
      advisorResults: [advisor("completed"), advisor("failed"), advisor("timed_out")],
      configuredDiversity: diversity("satisfied", 3, 3),
      error: "threshold not met",
    }
    const { manager } = createFakeManager(() => failedRun)
    const moaTool = createMoaConsultTool(manager, config)

    // When the tool runs
    const result = await moaTool.execute({ prompt: "x" }, context)

    // Then the bundle reports the failed status, the timed-out advisor, and the error warning
    if (typeof result === "string") throw new Error("expected a structured result")
    const bundle = result.metadata
    expect(bundle?.status).toBe("failed")
    expect(bundle?.synthesis).toBeUndefined()
    expect(bundle?.advisorSummary).toEqual({ requested: 3, successful: 1, failed: 1, timedOut: 1 })
    expect(bundle?.warnings).toContain("threshold not met")
  })
})

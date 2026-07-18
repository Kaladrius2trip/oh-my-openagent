import { describe, expect, test } from "bun:test"
import type {
  MoAChildHandle,
  MoAChildLaunchInput,
  MoAChildResult,
  MoAChildWaitTimeouts,
  MoAExecutionAdapter,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"
import type { MoAChildStatus, MoAPresetConfig, MoATarget } from "@oh-my-opencode/moa-core"

import { createMoAManager } from "./moa-manager"

const models = {
  "advisor-a": { providerID: "anthropic", modelID: "claude-opus-4-7" },
  "advisor-b": { providerID: "openai", modelID: "gpt-5.6-sol" },
  "advisor-c": { providerID: "google", modelID: "gemini-3.1-pro" },
  aggregator: { providerID: "openai", modelID: "gpt-5.5" },
} as const

class FakeAdapter implements MoAExecutionAdapter {
  readonly launches: MoAChildLaunchInput[] = []
  readonly cancellations: string[] = []
  readonly waits: MoAChildWaitTimeouts[] = []
  firstLaunchResolutionCount = 0
  aggregatorStatus: MoAChildStatus = "completed"
  waitFailureSlot: string | undefined
  private resolutionCount = 0
  private readonly targetByTask = new Map<string, ResolvedMoATarget>()
  private launchReadyResolve: (() => void) | undefined
  readonly advisorsLaunched = new Promise<void>((resolve) => {
    this.launchReadyResolve = resolve
  })

  constructor(
    private readonly advisorStatuses: Readonly<Record<string, MoAChildStatus>> = {},
    private readonly blockUntilAbort = false,
    private readonly collapseProvider = false,
  ) {}

  async resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
    this.resolutionCount += 1
    const name = "category" in target ? target.category : target.subagent_type
    const base = models[name as keyof typeof models] ?? models["advisor-a"]
    const model = this.collapseProvider ? { providerID: "openai", modelID: base.modelID } : base
    return { requested: target, agent: "sisyphus-junior", category: name, model, fallbackChain: [] }
  }

  async launchChild(input: MoAChildLaunchInput): Promise<MoAChildHandle> {
    if (this.launches.length === 0) this.firstLaunchResolutionCount = this.resolutionCount
    this.launches.push(input)
    const taskId = `task-${this.launches.length}`
    this.targetByTask.set(taskId, input.target)
    if (this.launches.filter((launch) => launch.role === "advisor").length === 3) this.launchReadyResolve?.()
    return { taskId, role: input.role, ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}) }
  }

  async waitForChild(handle: MoAChildHandle, timeouts: MoAChildWaitTimeouts, signal: AbortSignal): Promise<MoAChildResult> {
    this.waits.push(timeouts)
    const target = this.targetByTask.get(handle.taskId)
    if (target === undefined) throw new Error(`Missing target for ${handle.taskId}`)
    if (this.waitFailureSlot !== undefined && handle.slot === this.waitFailureSlot) {
      throw new Error(`wait failed for ${handle.slot}`)
    }
    if (this.blockUntilAbort && handle.role === "advisor") {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      return { handle, status: "cancelled", finalModel: target.model, fallbackCount: 0 }
    }
    const status = handle.role === "aggregator"
      ? this.aggregatorStatus
      : this.advisorStatuses[handle.slot ?? ""] ?? "completed"
    return {
      handle,
      status,
      ...(status === "completed" ? { output: handle.role === "aggregator" ? "final synthesis" : `${handle.slot} report` } : {}),
      finalModel: target.model,
      fallbackCount: 0,
    }
  }

  async cancelChild(handle: MoAChildHandle): Promise<void> {
    this.cancellations.push(handle.taskId)
  }
}

type ActivityTimeoutConfig = Pick<
  MoAPresetConfig,
  "advisor_timeout_ms" | "aggregator_timeout_ms" | "idle_window_ms" | "max_wall_ms"
>

const explicitActivityTimeouts: ActivityTimeoutConfig = {
  advisor_timeout_ms: 50,
  aggregator_timeout_ms: 50,
  idle_window_ms: 25,
  max_wall_ms: 200,
}

function createManager(adapter: FakeAdapter, activityTimeouts: ActivityTimeoutConfig = explicitActivityTimeouts) {
  return createMoAManager({
    config: {
      enabled: true,
      default_preset: "test",
      default_prompt_pack: "omo-hermes-derived-v1",
      max_advisors_per_run: 8,
      presets: {
        test: {
          execution_policy: "consultation_only",
          prompt_pack: "omo-hermes-derived-v1",
          advisors: [
            { name: "advisor-a", category: "advisor-a", role: "architect", mode: "analysis", temperature: 0.8, tool_policy: "read_only" },
            { name: "advisor-b", category: "advisor-b", role: "validator", mode: "analysis", tool_policy: "none" },
            { name: "advisor-c", category: "advisor-c", role: "challenger", mode: "analysis", tool_policy: "none" },
          ],
          aggregator: { category: "aggregator", temperature: 0.2 },
          context: { mode: "task_only" },
          diversity: {
            min_distinct_providers: 2,
            min_distinct_models: 2,
            on_configured_violation: "fail",
            on_effective_violation: "degrade",
          },
          min_successful_advisors: 2,
          ...activityTimeouts,
        },
      },
    },
    createAdapter: () => adapter,
    createRunId: () => "run-1",
  })
}

const parent = { sessionID: "parent-session", messageID: "parent-message", messages: [] }

describe("createMoAManager", () => {
  test("#given three successful advisors #when consultation runs #then one aggregator completes after all targets resolve", async () => {
    // given
    const adapter = new FakeAdapter()

    // when
    const result = await createManager(adapter).run({ prompt: "Choose an architecture" }, parent)

    // then
    expect(result.status).toBe("completed")
    expect(result.synthesis).toBe("final synthesis")
    expect(adapter.firstLaunchResolutionCount).toBe(4)
    expect(adapter.launches.filter((launch) => launch.role === "aggregator")).toHaveLength(1)
  })

  test("#given per-role temperatures #when consultation runs #then advisor and aggregator launch inputs preserve them", async () => {
    // given
    const adapter = new FakeAdapter()

    // when
    await createManager(adapter).run({ prompt: "Choose an architecture" }, parent)

    // then
    const advisor = adapter.launches.find((launch) => launch.orchestration.slot === "advisor-a")
    const aggregator = adapter.launches.find((launch) => launch.role === "aggregator")
    expect(advisor?.temperature).toBe(0.8)
    expect(aggregator?.temperature).toBe(0.2)
  })

  test("#given mixed advisor tool policies #when consultation runs #then only configured advisors receive research controls", async () => {
    const adapter = new FakeAdapter()

    await createManager(adapter).run({ prompt: "Choose an architecture" }, parent)

    const researchAdvisor = adapter.launches.find((launch) => launch.orchestration.slot === "advisor-a")
    const toolFreeAdvisor = adapter.launches.find((launch) => launch.orchestration.slot === "advisor-b")
    const aggregator = adapter.launches.find((launch) => launch.role === "aggregator")
    expect(researchAdvisor).toMatchObject({ toolPolicy: "read_only", capabilityProfile: "moa-research" })
    expect(toolFreeAdvisor).toMatchObject({ toolPolicy: "none", capabilityProfile: "moa-consultation-only" })
    expect(aggregator).toMatchObject({ toolPolicy: "none", capabilityProfile: "moa-consultation-only" })
  })

  test("#given preset activity timeout values #when consultation runs #then advisor and aggregator waits receive them uniformly", async () => {
    // given
    const adapter = new FakeAdapter()

    // when
    await createManager(adapter).run({ prompt: "Choose an architecture" }, parent)

    // then
    expect(adapter.waits).toEqual(Array.from({ length: 4 }, () => ({
      baseMs: 50,
      idleWindowMs: 25,
      maxWallMs: 200,
    })))
  })

  test("#given activity timeout extensions are omitted #when consultation runs #then each role derives its hard cap from its base", async () => {
    // given
    const adapter = new FakeAdapter()
    const manager = createManager(adapter, {
      advisor_timeout_ms: 20,
      aggregator_timeout_ms: 30,
    })

    // when
    await manager.run({ prompt: "Choose an architecture" }, parent)

    // then
    expect(adapter.waits).toEqual([
      ...Array.from({ length: 3 }, () => ({ baseMs: 20, idleWindowMs: 60_000, maxWallMs: 80 })),
      { baseMs: 30, idleWindowMs: 60_000, maxWallMs: 120 },
    ])
  })

  test("#given one of three advisors fails with threshold two #when consultation runs #then result is degraded", async () => {
    // given
    const adapter = new FakeAdapter({ "advisor-c": "failed" })

    // when
    const result = await createManager(adapter).run({ prompt: "Review decision" }, parent)

    // then
    expect(result.status).toBe("degraded")
    expect(adapter.launches.filter((launch) => launch.role === "aggregator")).toHaveLength(1)
  })

  test("#given two of three advisors fail #when consultation runs #then result fails without aggregator", async () => {
    // given
    const adapter = new FakeAdapter({ "advisor-b": "failed", "advisor-c": "failed" })

    // when
    const result = await createManager(adapter).run({ prompt: "Review decision" }, parent)

    // then
    expect(result.status).toBe("failed")
    expect(adapter.launches.filter((launch) => launch.role === "aggregator")).toHaveLength(0)
  })

  test("#given advisor deadline overruns below threshold #when consultation runs #then result times out", async () => {
    // given
    const adapter = new FakeAdapter({ "advisor-a": "timed_out", "advisor-b": "timed_out", "advisor-c": "timed_out" })

    // when
    const result = await createManager(adapter).run({ prompt: "Review decision" }, parent)

    // then
    expect(result.status).toBe("timed_out")
    expect(adapter.launches.filter((launch) => launch.role === "aggregator")).toHaveLength(0)
  })

  test("#given advising is active #when run is cancelled #then every child is cancelled and run is cancelled", async () => {
    // given
    const adapter = new FakeAdapter({}, true)
    const manager = createManager(adapter)
    const runPromise = manager.run({ prompt: "Review decision" }, parent)
    await adapter.advisorsLaunched

    // when
    const cancelled = await manager.cancel("run-1", "parent cancelled")
    const result = await runPromise

    // then
    expect(cancelled).toBe(true)
    expect(result.status).toBe("cancelled")
    expect(adapter.cancellations).toHaveLength(3)
  })

  test("#given configured advisor models collapse to one provider #when consultation resolves #then it fails before launch", async () => {
    // given
    const adapter = new FakeAdapter({}, false, true)

    // when
    const result = await createManager(adapter).run({ prompt: "Review decision" }, parent)

    // then
    expect(result.status).toBe("failed")
    expect(adapter.launches).toHaveLength(0)
  })

  test("#given aggregator wait times out #when consultation terminates #then the aggregator child is cancelled", async () => {
    const adapter = new FakeAdapter()
    adapter.aggregatorStatus = "timed_out"

    const result = await createManager(adapter).run({ prompt: "Review decision" }, parent)

    expect(result.status).toBe("timed_out")
    expect(adapter.cancellations).toContain("task-4")
  })

  test("#given an advisor wait throws after all launches #when run catches the error #then every launched advisor is cancelled", async () => {
    const adapter = new FakeAdapter()
    adapter.waitFailureSlot = "advisor-c"

    const result = await createManager(adapter).run({ prompt: "Review decision" }, parent)

    expect(result.status).toBe("failed")
    expect(adapter.launches).toHaveLength(3)
    expect(adapter.cancellations).toEqual(["task-1", "task-2", "task-3"])
  })
})

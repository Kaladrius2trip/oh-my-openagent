import { describe, expect, test } from "bun:test"
import type {
  MoAChildHandle,
  MoAChildLaunchInput,
  MoAChildResult,
  MoAExecutionAdapter,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"
import type { MoATarget } from "@oh-my-opencode/moa-core"

import { createMoAManager } from "./moa-manager"

class CollapseAdapter implements MoAExecutionAdapter {
  readonly launches: MoAChildLaunchInput[] = []
  private readonly targets = new Map<string, ResolvedMoATarget>()

  async resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
    const name = "category" in target ? target.category : target.subagent_type
    const providerID = name === "advisor-a" ? "anthropic" : name === "advisor-b" ? "google" : "openai"
    return {
      requested: target,
      agent: "sisyphus-junior",
      category: name,
      model: { providerID, modelID: `${name}-model` },
      fallbackChain: [{ providerID: "openai", modelID: "gpt-5.5" }],
    }
  }

  async launchChild(input: MoAChildLaunchInput): Promise<MoAChildHandle> {
    const taskId = `task-${this.launches.length + 1}`
    this.launches.push(input)
    this.targets.set(taskId, input.target)
    return { taskId, role: input.role, ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}) }
  }

  async waitForChild(handle: MoAChildHandle): Promise<MoAChildResult> {
    if (!this.targets.has(handle.taskId)) throw new Error(`Missing target for ${handle.taskId}`)
    return {
      handle,
      status: "completed",
      output: handle.role === "aggregator" ? "decision bundle" : "advisor report",
      finalModel: handle.role === "advisor"
        ? { providerID: "openai", modelID: "gpt-5.5" }
        : { providerID: "openai", modelID: "aggregator" },
      fallbackCount: handle.role === "advisor" ? 1 : 0,
    }
  }

  async cancelChild(): Promise<void> {}
}

describe("MoA fallback collapse", () => {
  test("#given distinct configured targets settle on one fallback #when consultation runs #then result degrades and aggregates", async () => {
    // given
    const adapter = new CollapseAdapter()
    const manager = createMoAManager({
      config: {
        enabled: true,
        default_preset: "collapse",
        max_advisors_per_run: 8,
        presets: {
          collapse: {
            execution_policy: "consultation_only",
            advisors: [
              { name: "advisor-a", category: "advisor-a", tool_policy: "none" },
              { name: "advisor-b", category: "advisor-b", tool_policy: "none" },
            ],
            aggregator: { category: "aggregator" },
            diversity: {
              min_distinct_providers: 2,
              min_distinct_models: 2,
              on_configured_violation: "fail",
              on_effective_violation: "degrade",
            },
            min_successful_advisors: 2,
          },
        },
      },
      createAdapter: () => adapter,
      createRunId: () => "run-collapse",
    })

    // when
    const result = await manager.run({ prompt: "Review a fallback-sensitive decision" }, {
      sessionID: "parent-session",
      messageID: "parent-message",
      messages: [],
    })

    // then
    expect(result.status).toBe("degraded")
    expect(result.effectiveDiversity?.counts).toEqual({ providers: 1, models: 1 })
    expect(result.effectiveDiversity?.outcome).toBe("degraded")
    expect(adapter.launches.filter((launch) => launch.role === "aggregator")).toHaveLength(1)
  })
})

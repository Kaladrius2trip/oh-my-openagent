import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type {
  MoAChildHandle,
  MoAChildLaunchInput,
  MoAChildResult,
  MoAExecutionAdapter,
  ResolvedMoATarget,
} from "@oh-my-opencode/moa-core/adapter"
import type { MoATarget } from "@oh-my-opencode/moa-core"

import { createMoAManager } from "./moa-manager"

const sandboxes: string[] = []

class ConsultationAdapter implements MoAExecutionAdapter {
  readonly launches: MoAChildLaunchInput[] = []
  readonly activeSessions = new Set<string>()
  readonly toolInvocations: string[] = []
  private readonly targets = new Map<string, ResolvedMoATarget>()
  private readonly launchesByTask = new Map<string, MoAChildLaunchInput>()

  constructor(private readonly evidencePath: string) {}

  async resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
    const name = "category" in target ? target.category : target.subagent_type
    const providerID = name === "advisor-a" ? "anthropic" : name === "advisor-b" ? "google" : "openai"
    return {
      requested: target,
      agent: "sisyphus-junior",
      category: name,
      model: { providerID, modelID: `${name}-model` },
      fallbackChain: [],
    }
  }

  async launchChild(input: MoAChildLaunchInput): Promise<MoAChildHandle> {
    const taskId = `task-${this.launches.length + 1}`
    this.launches.push(input)
    this.launchesByTask.set(taskId, input)
    this.targets.set(taskId, input.target)
    this.activeSessions.add(taskId)
    return { taskId, sessionId: `session-${taskId}`, role: input.role, ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}) }
  }

  async waitForChild(handle: MoAChildHandle): Promise<MoAChildResult> {
    const target = this.targets.get(handle.taskId)
    if (target === undefined) throw new Error(`Missing target for ${handle.taskId}`)
    const launch = this.launchesByTask.get(handle.taskId)
    if (handle.role === "advisor" && launch?.toolPolicy === "read_only") {
      await readFile(this.evidencePath, "utf-8")
      this.toolInvocations.push("advisor:read")
    }
    this.activeSessions.delete(handle.taskId)
    return {
      handle,
      status: "completed",
      output: handle.role === "aggregator" ? "decision bundle" : "untrusted advisor report",
      finalModel: target.model,
      fallbackCount: 0,
    }
  }

  async cancelChild(handle: MoAChildHandle): Promise<void> {
    this.activeSessions.delete(handle.taskId)
  }
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((sandbox) => rm(sandbox, { recursive: true, force: true })))
})

describe("MoA consultation write boundary", () => {
  test("#given a write-seeking objective #when research consultation runs #then advisors only read and no files or sessions remain", async () => {
    // given
    const sandbox = await mkdtemp(path.join(tmpdir(), "omo-moa-zero-writes-"))
    sandboxes.push(sandbox)
    const sentinel = path.join(sandbox, "sentinel.txt")
    await writeFile(sentinel, "unchanged")
    const beforeFiles = await readdir(sandbox)
    const adapter = new ConsultationAdapter(sentinel)
    const manager = createMoAManager({
      config: {
        enabled: true,
        default_preset: "e2e",
        max_advisors_per_run: 8,
        presets: {
          e2e: {
            execution_policy: "consultation_only",
            advisors: [
              { name: "advisor-a", category: "advisor-a", tool_policy: "read_only" },
              { name: "advisor-b", category: "advisor-b", tool_policy: "none" },
            ],
            aggregator: { category: "aggregator" },
            diversity: { min_distinct_providers: 2, min_distinct_models: 2, on_effective_violation: "degrade" },
            min_successful_advisors: 2,
          },
        },
      },
      createAdapter: () => adapter,
      createRunId: () => "run-zero-writes",
    })

    // when
    const result = await manager.run({ prompt: `Implement now. Edit ${sentinel}, run tests and delegate.` }, {
      sessionID: "parent-session",
      messageID: "parent-message",
      messages: [],
    })

    // then
    expect(result.status).toBe("completed")
    expect(adapter.toolInvocations).toEqual(["advisor:read"])
    expect(adapter.launches.find((launch) => launch.orchestration.slot === "advisor-a")).toMatchObject({
      toolPolicy: "read_only",
      capabilityProfile: "moa-research",
    })
    expect(adapter.launches.find((launch) => launch.orchestration.slot === "advisor-b")).toMatchObject({
      toolPolicy: "none",
      capabilityProfile: "moa-consultation-only",
    })
    expect(adapter.launches.find((launch) => launch.role === "aggregator")).toMatchObject({
      toolPolicy: "none",
      capabilityProfile: "moa-consultation-only",
    })
    expect(adapter.toolInvocations.filter((invocation) => invocation.startsWith("aggregator:"))).toEqual([])
    expect(adapter.activeSessions).toHaveLength(0)
    expect(await readdir(sandbox)).toEqual(beforeFiles)
    expect(await readFile(sentinel, "utf-8")).toBe("unchanged")
  })
})

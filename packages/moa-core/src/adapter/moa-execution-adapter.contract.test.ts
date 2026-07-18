/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MoATarget } from "../types"
import {
  assertConsultationOnlyLaunch,
  type MoAChildHandle,
  type MoAChildLaunchInput,
  type MoAChildResult,
  type MoAChildWaitTimeouts,
  type MoAExecutionAdapter,
  type ResolvedMoATarget,
} from "./moa-execution-adapter"

function resolved(category: string, providerID: string, modelID: string): ResolvedMoATarget {
  return {
    requested: { category },
    agent: category,
    category,
    model: { providerID, modelID },
    fallbackChain: [],
  }
}

function consultationLaunch(target: ResolvedMoATarget, runId: string): MoAChildLaunchInput {
  return {
    role: "advisor",
    target,
    prompt: "advisor prompt",
    visibility: "internal",
    notificationPolicy: "manual",
    suppressTmuxSpawn: true,
    toolPolicy: "none",
    capabilityProfile: "moa-consultation-only",
    continuationPolicy: "forbid",
    orchestration: { kind: "moa", runId, role: "advisor", slot: "architect" },
  }
}

function researchLaunch(target: ResolvedMoATarget, runId: string): MoAChildLaunchInput {
  return {
    ...consultationLaunch(target, runId),
    toolPolicy: "read_only",
    capabilityProfile: "moa-research",
  }
}

function aggregatorLaunch(target: ResolvedMoATarget, runId: string): MoAChildLaunchInput {
  return {
    ...consultationLaunch(target, runId),
    role: "aggregator",
    orchestration: { kind: "moa", runId, role: "aggregator" },
  }
}

function createFakeAdapter(): MoAExecutionAdapter & {
  launches: MoAChildLaunchInput[]
  waits: MoAChildWaitTimeouts[]
  cancellations: string[]
} {
  const launches: MoAChildLaunchInput[] = []
  const waits: MoAChildWaitTimeouts[] = []
  const cancellations: string[] = []
  let counter = 0
  return {
    launches,
    waits,
    cancellations,
    async resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
      if ("category" in target && target.category !== undefined) {
        return resolved(target.category, "anthropic", "claude-opus-4-7")
      }
      if ("subagent_type" in target && target.subagent_type !== undefined) {
        return resolved(target.subagent_type, "anthropic", "claude-opus-4-7")
      }
      throw new Error("MoA target missing")
    },
    async launchChild(input: MoAChildLaunchInput): Promise<MoAChildHandle> {
      launches.push(input)
      counter += 1
      return {
        taskId: `task-${counter}`,
        role: input.role,
        ...(input.orchestration.slot !== undefined ? { slot: input.orchestration.slot } : {}),
      }
    },
    async waitForChild(handle: MoAChildHandle, timeouts: MoAChildWaitTimeouts): Promise<MoAChildResult> {
      waits.push(timeouts)
      return {
        handle,
        status: "completed",
        output: "advisor report",
        finalModel: { providerID: "anthropic", modelID: "claude-opus-4-7" },
        fallbackCount: 0,
      }
    },
    async cancelChild(handle: MoAChildHandle): Promise<void> {
      cancellations.push(handle.taskId)
    },
  }
}

describe("MoAExecutionAdapter port", () => {
  test("#given a fake adapter #when driven through the port #then resolve, launch, wait and cancel round-trip", async () => {
    const adapter = createFakeAdapter()
    const target = await adapter.resolveTarget({ category: "moa-architect" })
    const handle = await adapter.launchChild(consultationLaunch(target, "run-1"))
    const timeouts = { baseMs: 1_000, idleWindowMs: 60_000, maxWallMs: 4_000 }
    const result = await adapter.waitForChild(handle, timeouts, new AbortController().signal)
    await adapter.cancelChild(handle, "done")

    expect(target.model.providerID).toBe("anthropic")
    expect(handle.taskId).toBe("task-1")
    expect(result.status).toBe("completed")
    expect(adapter.waits).toEqual([timeouts])
    expect(adapter.cancellations).toEqual(["task-1"])
  })

  test("#given both advisor tiers #when asserted #then each valid policy-profile pair is accepted", () => {
    const adapter = createFakeAdapter()
    const target = resolved("moa-architect", "openai", "gpt-5.5")
    const toolFree = consultationLaunch(target, "run-1")
    const research = researchLaunch(target, "run-1")

    expect(() => assertConsultationOnlyLaunch(toolFree)).not.toThrow()
    expect(() => assertConsultationOnlyLaunch(research)).not.toThrow()
    expect(research.toolPolicy).toBe("read_only")
    expect(research.capabilityProfile).toBe("moa-research")
    void adapter
  })

  test("#given a research aggregator #when asserted #then it is rejected", () => {
    const input = aggregatorLaunch(resolved("moa-aggregator", "openai", "gpt-5.5"), "run-1")
    Reflect.set(input, "toolPolicy", "read_only")
    Reflect.set(input, "capabilityProfile", "moa-research")

    expect(() => assertConsultationOnlyLaunch(input)).toThrow(/aggregator/i)
  })

  test.each([
    ["none", "moa-research"],
    ["read_only", "moa-consultation-only"],
  ] as const)("#given advisor pair %s and %s #when asserted #then it is rejected", (toolPolicy, capabilityProfile) => {
    const input = consultationLaunch(resolved("moa-architect", "openai", "gpt-5.5"), "run-1")
    Reflect.set(input, "toolPolicy", toolPolicy)
    Reflect.set(input, "capabilityProfile", capabilityProfile)

    expect(() => assertConsultationOnlyLaunch(input)).toThrow(/policy-profile pair/i)
  })

  test("#given an unknown capability profile #when asserted #then it is rejected explicitly", () => {
    const input = consultationLaunch(resolved("moa-architect", "openai", "gpt-5.5"), "run-1")
    Reflect.set(input, "capabilityProfile", "unknown-profile")

    expect(() => assertConsultationOnlyLaunch(input)).toThrow(/Unknown capability profile/)
  })

  test("#given role deviation from orchestration #when asserted #then it is rejected", () => {
    const input = consultationLaunch(resolved("moa-architect", "openai", "gpt-5.5"), "run-1")
    Reflect.set(input.orchestration, "role", "aggregator")

    expect(() => assertConsultationOnlyLaunch(input)).toThrow(/role must match orchestration role/i)
  })

  test("#given a launch input missing a pinned control #when asserted #then it throws", () => {
    const input = consultationLaunch(resolved("moa-architect", "openai", "gpt-5.5"), "run-1")
    Reflect.set(input, "continuationPolicy", "allow")

    expect(() => assertConsultationOnlyLaunch(input)).toThrow()
  })
})

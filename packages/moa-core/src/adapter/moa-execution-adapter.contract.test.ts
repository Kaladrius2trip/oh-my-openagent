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

  test("#given a launched advisor #when inspected #then it carries all six consultation controls", () => {
    const adapter = createFakeAdapter()
    const input = consultationLaunch(resolved("moa-architect", "openai", "gpt-5.5"), "run-1")

    expect(() => assertConsultationOnlyLaunch(input)).not.toThrow()
    expect(input.visibility).toBe("internal")
    expect(input.notificationPolicy).toBe("manual")
    expect(input.suppressTmuxSpawn).toBe(true)
    expect(input.toolPolicy).toBe("none")
    expect(input.capabilityProfile).toBe("moa-consultation-only")
    expect(input.continuationPolicy).toBe("forbid")
    void adapter
  })

  test("#given a launch input missing a control #when asserted #then it throws", () => {
    const tampered = consultationLaunch(resolved("moa-architect", "openai", "gpt-5.5"), "run-1")
    Reflect.set(tampered, "continuationPolicy", "allow")

    expect(() => assertConsultationOnlyLaunch(tampered)).toThrow()
  })
})

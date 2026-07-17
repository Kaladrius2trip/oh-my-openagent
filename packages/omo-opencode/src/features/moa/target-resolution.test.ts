import { describe, expect, test } from "bun:test"

import {
  createMoATargetResolver,
  MoATargetResolutionError,
} from "./target-resolution"

describe("createMoATargetResolver", () => {
  test("#given a category target #when it resolves #then category execution supplies model and fallback descriptors", async () => {
    // given
    const calls: string[] = []
    const resolveTarget = createMoATargetResolver({
      deps: {
        resolveCategoryExecutionFn: async (category) => {
          calls.push(category)
          return {
            agent: "sisyphus-junior",
            category,
            model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
            fallbackChain: [{ providers: ["openai", "vercel"], model: "gpt-5.5", reasoningEffort: "high" }],
          }
        },
      },
    })

    // when
    const resolved = await resolveTarget({ category: "moa-architect" })

    // then
    expect(calls).toEqual(["moa-architect"])
    expect(resolved).toEqual({
      requested: { category: "moa-architect" },
      agent: "sisyphus-junior",
      category: "moa-architect",
      model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
      fallbackChain: [
        { providerID: "openai", modelID: "gpt-5.5", reasoningEffort: "high" },
        { providerID: "vercel", modelID: "gpt-5.5", reasoningEffort: "high" },
      ],
    })
  })

  test("#given a callable subagent target #when it resolves #then subagent model resolution supplies its concrete target", async () => {
    // given
    const calls: string[] = []
    const resolveTarget = createMoATargetResolver({
      deps: {
        resolveSubagentModelFn: async (subagentType) => {
          calls.push(subagentType)
          return {
            agent: "oracle",
            agentMode: "subagent",
            model: { providerID: "openai", modelID: "gpt-5.6-sol", reasoningEffort: "xhigh" },
            fallbackChain: [{ providers: ["anthropic"], model: "claude-opus-4-7", variant: "max" }],
          }
        },
      },
    })

    // when
    const resolved = await resolveTarget({ subagent_type: "oracle" })

    // then
    expect(calls).toEqual(["oracle"])
    expect(resolved.agent).toBe("oracle")
    expect(resolved.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    })
    expect(resolved.fallbackChain).toEqual([
      { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
    ])
  })

  test("#given a primary agent target #when it resolves #then resolution rejects it", async () => {
    // given
    const resolveTarget = createMoATargetResolver({
      deps: {
        resolveSubagentModelFn: async () => ({
          agent: "sisyphus",
          agentMode: "primary",
          model: { providerID: "openai", modelID: "gpt-5.6-sol" },
          fallbackChain: [],
        }),
      },
    })

    // when
    const result = resolveTarget({ subagent_type: "sisyphus" })

    // then
    expect(result).rejects.toBeInstanceOf(MoATargetResolutionError)
    expect(result).rejects.toThrow("primary agent")
  })

  test("#given a recursive MoA subagent target #when it resolves #then resolution rejects it before model lookup", async () => {
    // given
    let modelLookupCount = 0
    const resolveTarget = createMoATargetResolver({
      deps: {
        resolveSubagentModelFn: async () => {
          modelLookupCount += 1
          return {
            agent: "moa",
            agentMode: "subagent",
            model: { providerID: "openai", modelID: "gpt-5.5" },
            fallbackChain: [],
          }
        },
      },
    })

    // when
    const result = resolveTarget({ subagent_type: "moa" })

    // then
    expect(result).rejects.toBeInstanceOf(MoATargetResolutionError)
    expect(result).rejects.toThrow("recursive MoA")
    expect(modelLookupCount).toBe(0)
  })
})

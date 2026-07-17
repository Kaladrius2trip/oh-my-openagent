import { describe, expect, test } from "bun:test"
import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"

import { predictFallbackDiversity } from "./diversity-prediction"

function target(
  category: string,
  providerID: string,
  modelID: string,
  fallbackChain: ResolvedMoATarget["fallbackChain"],
): ResolvedMoATarget {
  return {
    requested: { category },
    agent: "sisyphus-junior",
    category,
    model: { providerID, modelID },
    fallbackChain,
  }
}

describe("predictFallbackDiversity", () => {
  test("#given GPT-first fallback chains collapse on one model #when diversity is predicted #then policy degrades", () => {
    // given
    const targets = [
      target("moa-architect", "anthropic", "claude-opus-4-7", [
        { providerID: "openai", modelID: "gpt-5.5" },
      ]),
      target("moa-challenger", "google", "gemini-3.1-pro", [
        { providerID: "openai", modelID: "gpt-5.5" },
      ]),
    ]

    // when
    const prediction = predictFallbackDiversity(targets, {
      min_distinct_providers: 2,
      min_distinct_models: 2,
      on_effective_violation: "degrade",
    })

    // then
    expect(prediction.outcome).toBe("degraded")
    expect(prediction.counts).toEqual({ providers: 1, models: 1 })
  })

  test("#given fallback chains remain provider-distinct #when diversity is predicted #then policy stays satisfied", () => {
    // given
    const targets = [
      target("moa-validator", "openai", "gpt-5.6-sol", [
        { providerID: "anthropic", modelID: "claude-opus-4-7" },
      ]),
      target("moa-challenger", "google", "gemini-3.1-pro", [
        { providerID: "vercel", modelID: "gemini-3.1-pro" },
      ]),
    ]

    // when
    const prediction = predictFallbackDiversity(targets, {
      min_distinct_providers: 2,
      min_distinct_models: 2,
      on_effective_violation: "degrade",
    })

    // then
    expect(prediction.outcome).toBe("satisfied")
    expect(prediction.counts).toEqual({ providers: 2, models: 2 })
  })
})

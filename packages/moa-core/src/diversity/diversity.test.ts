import { describe, expect, test } from "bun:test"
import type { MoAResolvedModel } from "../types"
import type { MoAAdvisorSettlement } from "./diversity"
import { countDistinct, evaluateConfiguredDiversity, evaluateDiversity, evaluateEffectiveDiversity } from "./diversity"

function model(providerID: string, modelID: string, variant?: string): MoAResolvedModel {
  return { providerID, modelID, variant }
}

function settled(name: string, status: MoAAdvisorSettlement["status"], m: MoAResolvedModel): MoAAdvisorSettlement {
  return { name, status, model: m }
}

describe("countDistinct", () => {
  test("#given two variants of the same model #when counted #then it is one model", () => {
    const counts = countDistinct([model("openai", "gpt-5.5", "high"), model("openai", "gpt-5.5", "xhigh")])

    expect(counts).toEqual({ providers: 1, models: 1 })
  })

  test("#given three distinct providers #when counted #then providers and models are three", () => {
    const counts = countDistinct([
      model("anthropic", "claude-opus-4-7"),
      model("openai", "gpt-5.6-sol"),
      model("google", "gemini-3.1-pro"),
    ])

    expect(counts).toEqual({ providers: 3, models: 3 })
  })
})

describe("evaluateConfiguredDiversity", () => {
  test("#given two advisors on the same provider and a two-provider minimum #when evaluated with fail #then it fails pre-launch", () => {
    const check = evaluateConfiguredDiversity([model("openai", "gpt-5.6-sol"), model("openai", "gpt-5.5")], {
      min_distinct_providers: 2,
      min_distinct_models: 2,
      on_configured_violation: "fail",
    })

    expect(check.satisfied).toBe(false)
    expect(check.outcome).toBe("failed")
    expect(check.counts.providers).toBe(1)
  })

  test("#given distinct providers meeting the minimum #when evaluated #then it is satisfied", () => {
    const check = evaluateConfiguredDiversity([model("anthropic", "claude-opus-4-7"), model("openai", "gpt-5.5")], {
      min_distinct_providers: 2,
      min_distinct_models: 2,
      on_configured_violation: "fail",
    })

    expect(check.satisfied).toBe(true)
    expect(check.outcome).toBe("satisfied")
  })
})

describe("evaluateEffectiveDiversity", () => {
  test("#given fallback collapse onto one provider #when evaluated with degrade #then it degrades", () => {
    const check = evaluateEffectiveDiversity(
      [
        settled("architect", "completed", model("openai", "gpt-5.5")),
        settled("validator", "completed", model("openai", "gpt-5.5")),
      ],
      { min_distinct_providers: 2, min_distinct_models: 2, on_effective_violation: "degrade" },
    )

    expect(check.satisfied).toBe(false)
    expect(check.outcome).toBe("degraded")
    expect(check.counts.providers).toBe(1)
  })

  test("#given a failed advisor #when effective diversity is evaluated #then the failed advisor is excluded", () => {
    const check = evaluateEffectiveDiversity(
      [
        settled("architect", "completed", model("anthropic", "claude-opus-4-7")),
        settled("validator", "completed", model("openai", "gpt-5.5")),
        settled("challenger", "failed", model("google", "gemini-3.1-pro")),
      ],
      { min_distinct_providers: 2, min_distinct_models: 2, on_effective_violation: "degrade" },
    )

    expect(check.counts.providers).toBe(2)
    expect(check.satisfied).toBe(true)
    expect(check.outcome).toBe("satisfied")
  })

  test("#given a warn policy on a violation #when evaluated #then status stays satisfied but a warning is present", () => {
    const check = evaluateEffectiveDiversity([settled("architect", "completed", model("openai", "gpt-5.5"))], {
      min_distinct_providers: 2,
      min_distinct_models: 2,
      on_effective_violation: "warn",
    })

    expect(check.satisfied).toBe(false)
    expect(check.outcome).toBe("satisfied")
    expect(check.warning).toBeDefined()
  })
})

describe("evaluateDiversity", () => {
  test("#given a distinct aggregator provider #when combined diversity is evaluated #then the aggregator does not count toward advisor diversity", () => {
    const result = evaluateDiversity({
      configuredAdvisorModels: [model("openai", "gpt-5.5"), model("openai", "gpt-5.6-sol")],
      settledAdvisors: [
        settled("architect", "completed", model("openai", "gpt-5.5")),
        settled("validator", "completed", model("openai", "gpt-5.6-sol")),
      ],
      aggregatorModel: model("anthropic", "claude-opus-4-7"),
      config: { min_distinct_providers: 2, min_distinct_models: 2, on_configured_violation: "fail" },
    })

    expect(result.configuredProviders).toBe(1)
    expect(result.effectiveProviders).toBe(1)
    expect(result.outcome).toBe("failed")
  })

  test("#given satisfied configured and effective diversity #when combined #then the outcome is satisfied", () => {
    const result = evaluateDiversity({
      configuredAdvisorModels: [model("anthropic", "claude-opus-4-7"), model("openai", "gpt-5.5")],
      settledAdvisors: [
        settled("architect", "completed", model("anthropic", "claude-opus-4-7")),
        settled("validator", "completed", model("openai", "gpt-5.5")),
      ],
      aggregatorModel: model("google", "gemini-3.1-pro"),
      config: { min_distinct_providers: 2, min_distinct_models: 2, on_configured_violation: "fail", on_effective_violation: "degrade" },
    })

    expect(result.outcome).toBe("satisfied")
    expect(result.effectiveProviders).toBe(2)
  })
})

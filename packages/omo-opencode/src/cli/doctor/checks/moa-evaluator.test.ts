import { describe, expect, test } from "bun:test"
import { evaluateMoAConfig } from "./moa-evaluator"

const distinctCategories = {
  "fixture-a": {
    model: "anthropic/fixture-a",
    fallback_models: ["openai/shared-fallback"],
  },
  "fixture-b": {
    model: "google/fixture-b",
    fallback_models: ["openai/shared-fallback"],
  },
  "fixture-aggregator": { model: "openai/fixture-aggregator" },
}

function preset(options: {
  readonly disabled?: boolean
  readonly duplicateNames?: boolean
  readonly readOnly?: boolean
  readonly temperature?: number
} = {}) {
  return {
    ...(options.disabled === undefined ? {} : { enabled: !options.disabled }),
    execution_policy: "consultation_only",
    advisors: [
      {
        name: "architect",
        category: "fixture-a",
        tool_policy: options.readOnly === true ? "read_only" : "none",
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      },
      {
        name: options.duplicateNames === true ? "architect" : "validator",
        category: "fixture-b",
        tool_policy: "none",
      },
    ],
    aggregator: { category: "fixture-aggregator" },
    diversity: {
      min_distinct_providers: 2,
      min_distinct_models: 2,
      on_configured_violation: "fail",
      on_effective_violation: "degrade",
    },
  }
}

function candidate(presetValue: object = preset(), categories: object = distinctCategories) {
  return {
    moa: {
      enabled: true,
      default_preset: "fixture",
      presets: { fixture: presetValue },
    },
    categories,
  }
}

const dependencies = {
  builtinCategories: {},
  builtinPresets: {},
}

describe("evaluateMoAConfig", () => {
  test("#given invalid MoA schema #when evaluated #then schema error blocks validation", () => {
    // given
    const config = { moa: { max_advisors_per_run: 0 } }

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.valid).toBe(false)
    expect(result.errors.map((issue) => issue.code)).toContain("schema")
  })

  test("#given missing selected preset #when evaluated #then missing preset error is returned", () => {
    // given
    const config = { moa: { enabled: true, default_preset: "missing" } }

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.errors.map((issue) => issue.code)).toContain("missing_preset")
  })

  test("#given disabled selected preset #when evaluated #then disabled preset error is returned", () => {
    // given
    const config = candidate(preset({ disabled: true }))

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.errors.map((issue) => issue.code)).toContain("disabled_preset")
  })

  test("#given category without model #when evaluated #then invalid target error is returned", () => {
    // given
    const config = candidate(preset(), {
      ...distinctCategories,
      "fixture-a": {},
    })

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.errors.map((issue) => issue.code)).toContain("invalid_target")
  })

  test("#given duplicate advisor names #when evaluated #then structural preset error is returned", () => {
    // given
    const config = candidate(preset({ duplicateNames: true }))

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.errors.map((issue) => issue.code)).toContain("duplicate_advisor_name")
  })

  test("#given configured models miss diversity threshold #when evaluated #then diversity error is returned", () => {
    // given
    const config = candidate(preset(), {
      ...distinctCategories,
      "fixture-a": { model: "openai/shared" },
      "fixture-b": { model: "openai/shared" },
    })

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.errors.map((issue) => issue.code)).toContain("configured_diversity")
  })

  test("#given unsupported role temperature #when evaluated #then warning does not block validation", () => {
    // given
    const config = candidate(preset({ temperature: 0.8 }))

    // when
    const result = evaluateMoAConfig(config, {
      ...dependencies,
      supportsTemperature: (model) => model !== "anthropic/fixture-a",
    })

    // then
    expect(result.valid).toBe(true)
    expect(result.warnings.map((issue) => issue.code)).toContain("unsupported_temperature")
  })

  test("#given optional model hints omit configured model #when evaluated #then unknown-model warning does not block", () => {
    // given
    const config = candidate()

    // when
    const result = evaluateMoAConfig(config, {
      ...dependencies,
      knownModels: new Set(["google/fixture-b", "openai/fixture-aggregator"]),
    })

    // then
    expect(result.valid).toBe(true)
    expect(result.warnings.map((issue) => issue.code)).toContain("unknown_model_hint")
  })

  test("#given a read-only advisor #when evaluated #then policy and exact tool exposure are reported", () => {
    const result = evaluateMoAConfig(candidate(preset({ readOnly: true })), dependencies)

    expect(result.toolExposure).toEqual({
      advisorPolicies: [
        { name: "architect", policy: "read_only" },
        { name: "validator", policy: "none" },
      ],
      advisorToolsExposed: ["read", "grep", "glob"],
      aggregatorToolsExposed: [],
      toolsExposed: 3,
    })
  })

  test("#given fallback chains can collapse #when evaluated #then prediction warning does not block", () => {
    // given
    const config = candidate()

    // when
    const result = evaluateMoAConfig(config, dependencies)

    // then
    expect(result.valid).toBe(true)
    expect(result.warnings.map((issue) => issue.code)).toContain("fallback_collapse")
  })
})

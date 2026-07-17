import { describe, expect, test } from "bun:test"
import type { MoAPresetConfig } from "../types"
import { BUILTIN_PRESETS, DEFAULT_PRESET_NAME } from "./index"
import { validatePreset } from "./validate-preset"

function baseValidPreset(): MoAPresetConfig {
  return {
    advisors: [
      { name: "architect", role: "architect", mode: "analysis", category: "moa-architect", tool_policy: "none" },
      { name: "validator", role: "validator", mode: "analysis", category: "moa-validator", tool_policy: "none" },
    ],
    aggregator: { category: "moa-aggregator" },
    min_successful_advisors: 2,
    diversity: { min_distinct_providers: 2, min_distinct_models: 2 },
  }
}

describe("BUILTIN_PRESETS", () => {
  test("#given the default preset name #when looked up #then it resolves to architecture-balanced", () => {
    expect(DEFAULT_PRESET_NAME).toBe("architecture-balanced")
    expect(BUILTIN_PRESETS[DEFAULT_PRESET_NAME]).toBeDefined()
  })

  test("#given all seven built-in presets #when validated #then none reports an error", () => {
    const names = Object.keys(BUILTIN_PRESETS).toSorted()

    expect(names).toEqual(
      [
        "architecture-balanced",
        "budget",
        "code-review",
        "decision-fast",
        "hermes-like-frontier",
        "planning-rigorous",
        "security-critical",
      ].toSorted(),
    )

    for (const [name, preset] of Object.entries(BUILTIN_PRESETS)) {
      expect({ name, errors: validatePreset(preset) }).toEqual({ name, errors: [] })
    }
  })

  test("#given each built-in preset #when its advisor targets are inspected #then exactly one selector is set", () => {
    for (const preset of Object.values(BUILTIN_PRESETS)) {
      for (const advisor of preset.advisors) {
        const hasCategory = "category" in advisor && advisor.category !== undefined
        const hasSubagent = "subagent_type" in advisor && advisor.subagent_type !== undefined
        expect(hasCategory !== hasSubagent).toBe(true)
      }
    }
  })
})

describe("validatePreset", () => {
  test("#given a preset with zero advisors #when validated #then it reports no_advisors", () => {
    const preset = { ...baseValidPreset(), advisors: [], min_successful_advisors: undefined }

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("no_advisors")
  })

  test("#given a preset with nine advisors #when validated against the cap of eight #then it reports too_many_advisors", () => {
    const advisors = Array.from({ length: 9 }, (_, index) => ({
      name: `advisor-${index}`,
      role: "general" as const,
      mode: "analysis" as const,
      category: `moa-generalist-${index}`,
      tool_policy: "none" as const,
    }))
    const preset: MoAPresetConfig = { ...baseValidPreset(), advisors, min_successful_advisors: 4 }

    const codes = validatePreset(preset, { maxAdvisors: 8 }).map((error) => error.code)

    expect(codes).toContain("too_many_advisors")
  })

  test("#given duplicate advisor names #when validated #then it reports duplicate_advisor_name", () => {
    const preset = baseValidPreset()
    preset.advisors[1] = { ...preset.advisors[1], name: preset.advisors[0]!.name } as MoAPresetConfig["advisors"][number]

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("duplicate_advisor_name")
  })

  test("#given an unknown advisor role #when validated #then it reports unknown_role", () => {
    const preset = baseValidPreset()
    preset.advisors[0] = { ...preset.advisors[0], role: "implementer" as never } as MoAPresetConfig["advisors"][number]

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("unknown_role")
  })

  test("#given an implementation mode #when validated #then it reports unknown_mode", () => {
    const preset = baseValidPreset()
    preset.advisors[0] = { ...preset.advisors[0], mode: "implementation" as never } as MoAPresetConfig["advisors"][number]

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("unknown_mode")
  })

  test("#given a diversity threshold above the advisor count #when validated #then it reports diversity_exceeds_advisors", () => {
    const preset: MoAPresetConfig = {
      ...baseValidPreset(),
      diversity: { min_distinct_providers: 5, min_distinct_models: 2 },
    }

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("diversity_exceeds_advisors")
  })

  test("#given a success threshold above the advisor count #when validated #then it reports invalid_min_success", () => {
    const preset: MoAPresetConfig = { ...baseValidPreset(), min_successful_advisors: 3 }

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("invalid_min_success")
  })

  test("#given a non-consultation execution policy #when validated #then it reports invalid_execution_policy", () => {
    const preset = { ...baseValidPreset(), execution_policy: "implementation" as never }

    const codes = validatePreset(preset).map((error) => error.code)

    expect(codes).toContain("invalid_execution_policy")
  })
})

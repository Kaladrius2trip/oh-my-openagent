import { describe, expect, test } from "bun:test"
import type { UpdateJsoncFileOptions } from "@oh-my-opencode/omo-config-core"
import { evaluateMoAConfig } from "../doctor/checks/moa-evaluator"
import { setActiveMoaPreset } from "./use-preset"

function candidate(options: { readonly disabled?: boolean; readonly temperature?: number } = {}) {
  return {
    moa: {
      enabled: false,
      default_preset: "fixture",
      presets: {
        fixture: {
          ...(options.disabled === undefined ? {} : { enabled: !options.disabled }),
          advisors: [
            {
              name: "one",
              category: "fixture-a",
              tool_policy: "none",
              ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            },
            { name: "two", category: "fixture-b", tool_policy: "none" },
          ],
          aggregator: { category: "fixture-aggregator" },
          diversity: { min_distinct_providers: 2, min_distinct_models: 2 },
        },
      },
    },
    categories: {
      "fixture-a": { model: "anthropic/a" },
      "fixture-b": { model: "google/b" },
      "fixture-aggregator": { model: "openai/aggregator" },
    },
  }
}

const evaluationDependencies = {
  builtinCategories: {},
  builtinPresets: {},
}

describe("setActiveMoaPreset", () => {
  test("#given valid preset #when activated without enable #then candidate is evaluated before only default path is written", () => {
    // given
    const events: string[] = []
    const writes: UpdateJsoncFileOptions[] = []

    // when
    const result = setActiveMoaPreset({
      presetName: "fixture",
      enable: false,
      candidate: candidate(),
      configPath: "/tmp/oh-my-openagent.jsonc",
      evaluationDependencies,
      evaluate: (value, dependencies) => {
        events.push("evaluate")
        return evaluateMoAConfig(value, dependencies)
      },
      write: (options) => {
        events.push("write")
        writes.push(options)
        return { path: options.path }
      },
    })

    // then
    expect(result.ok).toBe(true)
    expect(events).toEqual(["evaluate", "write"])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.edits).toEqual([
      { path: ["moa", "default_preset"], value: "fixture" },
    ])
  })

  test.each([
    ["missing", candidate()],
    ["fixture", candidate({ disabled: true })],
  ])("#given %s unavailable preset #when activated #then writer is not called", (presetName, config) => {
    // given
    let writes = 0

    // when
    const result = setActiveMoaPreset({
      presetName,
      enable: false,
      candidate: config,
      configPath: "/tmp/oh-my-openagent.jsonc",
      evaluationDependencies,
      write: () => {
        writes += 1
        return { path: "/tmp/oh-my-openagent.jsonc" }
      },
    })

    // then
    expect(result.ok).toBe(false)
    expect(writes).toBe(0)
  })

  test("#given validation warning #when activated #then warning allows persistence", () => {
    // given
    let writes = 0

    // when
    const result = setActiveMoaPreset({
      presetName: "fixture",
      enable: false,
      candidate: candidate({ temperature: 0.7 }),
      configPath: "/tmp/oh-my-openagent.jsonc",
      evaluationDependencies: {
        ...evaluationDependencies,
        supportsTemperature: () => false,
      },
      write: (options) => {
        writes += 1
        return { path: options.path }
      },
    })

    // then
    expect(result.ok).toBe(true)
    expect(result.evaluation.warnings.map((warning) => warning.code)).toContain("unsupported_temperature")
    expect(writes).toBe(1)
  })

  test("#given explicit enable #when activated #then enabled true is persisted with default preset", () => {
    // given
    const writes: UpdateJsoncFileOptions[] = []

    // when
    setActiveMoaPreset({
      presetName: "fixture",
      enable: true,
      candidate: candidate(),
      configPath: "/tmp/oh-my-openagent.jsonc",
      evaluationDependencies,
      write: (options) => {
        writes.push(options)
        return { path: options.path }
      },
    })

    // then
    expect(writes[0]?.edits).toEqual([
      { path: ["moa", "default_preset"], value: "fixture" },
      { path: ["moa", "enabled"], value: true },
    ])
  })
})

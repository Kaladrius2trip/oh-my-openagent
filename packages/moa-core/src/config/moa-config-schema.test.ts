/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { MoAPresetConfigSchema } from "./moa-config-schema"

const basePreset = {
  advisors: [{ name: "architect", category: "moa-architect" }],
  aggregator: { category: "moa-aggregator" },
}

describe("MoAPresetConfigSchema activity timeouts", () => {
  test("#given omitted activity timeout keys #when parsed #then idle grace defaults and max wall stays runtime-derived", () => {
    // given
    const input = basePreset

    // when
    const result = MoAPresetConfigSchema.parse(input)

    // then
    expect(result.idle_window_ms).toBe(60_000)
    expect(result.max_wall_ms).toBeUndefined()
  })

  test("#given explicit activity timeout keys and an unknown key #when parsed #then values remain and unknown data is stripped", () => {
    // given
    const input = {
      ...basePreset,
      idle_window_ms: 45_000,
      max_wall_ms: 500_000,
      unknown_timeout_key: 123,
    }

    // when
    const result = MoAPresetConfigSchema.parse(input)

    // then
    expect(result.idle_window_ms).toBe(45_000)
    expect(result.max_wall_ms).toBe(500_000)
    expect("unknown_timeout_key" in result).toBe(false)
  })

  test.each([
    ["idle_window_ms", 0],
    ["idle_window_ms", -1],
    ["max_wall_ms", 0],
    ["max_wall_ms", -1],
  ] as const)("#given %s is %d #when parsed #then the preset is rejected", (key, value) => {
    // given
    const input = { ...basePreset, [key]: value }

    // when / then
    expect(() => MoAPresetConfigSchema.parse(input)).toThrow()
  })
})

import { describe, expect, test } from "bun:test"
import { MoAConfigSchema, MoAPresetConfigSchema } from "./moa"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("MoAConfigSchema", () => {
  describe("#given an empty MoA config", () => {
    test("#when parsed #then defaults are applied and feature is disabled", () => {
      const result = MoAConfigSchema.parse({})

      expect(result.enabled).toBe(false)
      expect(result.default_preset).toBe("architecture-balanced")
      expect(result.default_prompt_pack).toBe("omo-hermes-derived-v1")
      expect(result.max_advisors_per_run).toBe(8)
    })
  })

  describe("#given only enabled: true", () => {
    test("#when parsed #then remaining defaults fill in", () => {
      const result = MoAConfigSchema.parse({ enabled: true })

      expect(result.enabled).toBe(true)
      expect(result.default_preset).toBe("architecture-balanced")
      expect(result.max_advisors_per_run).toBe(8)
    })
  })

  describe("#given max_advisors_per_run above the cap (9)", () => {
    test("#when parsed #then it is rejected", () => {
      expect(() => MoAConfigSchema.parse({ max_advisors_per_run: 9 })).toThrow()
    })
  })
})

describe("MoAPresetConfigSchema", () => {
  describe("#given a well-formed preset", () => {
    test("#when parsed #then it is accepted", () => {
      const preset = MoAPresetConfigSchema.parse({
        advisors: [{ name: "architect", role: "architect", mode: "analysis", category: "moa-architect", tool_policy: "none" }],
        aggregator: { category: "moa-aggregator", maxTokens: 4400 },
      })

      expect(preset.advisors).toHaveLength(1)
      expect(preset.aggregator.category).toBe("moa-aggregator")
    })
  })

  describe("#given an advisor with neither category nor subagent_type", () => {
    test("#when parsed #then it is rejected", () => {
      expect(() =>
        MoAPresetConfigSchema.parse({
          advisors: [{ name: "architect" }],
          aggregator: { category: "moa-aggregator" },
        }),
      ).toThrow()
    })
  })

  describe("#given an advisor with both category and subagent_type", () => {
    test("#when parsed #then it is rejected", () => {
      expect(() =>
        MoAPresetConfigSchema.parse({
          advisors: [{ name: "architect", category: "moa-architect", subagent_type: "explore" }],
          aggregator: { category: "moa-aggregator" },
        }),
      ).toThrow()
    })
  })

  describe("#given an empty advisor array", () => {
    test("#when parsed #then it is rejected", () => {
      expect(() =>
        MoAPresetConfigSchema.parse({
          advisors: [],
          aggregator: { category: "moa-aggregator" },
        }),
      ).toThrow()
    })
  })

  describe("#given an unknown advisor mode", () => {
    test("#when parsed #then it is rejected", () => {
      expect(() =>
        MoAPresetConfigSchema.parse({
          advisors: [{ name: "architect", mode: "implementation", category: "moa-architect" }],
          aggregator: { category: "moa-aggregator" },
        }),
      ).toThrow()
    })
  })
})

describe("OhMyOpenCodeConfigSchema moa key", () => {
  describe("#given a config without moa", () => {
    test("#when parsed #then moa is undefined", () => {
      const result = OhMyOpenCodeConfigSchema.parse({})

      expect(result.moa).toBeUndefined()
    })
  })

  describe("#given a config with moa.enabled true", () => {
    test("#when parsed #then moa defaults are populated", () => {
      const result = OhMyOpenCodeConfigSchema.parse({ moa: { enabled: true } })

      expect(result.moa?.enabled).toBe(true)
      expect(result.moa?.default_preset).toBe("architecture-balanced")
      expect(result.moa?.max_advisors_per_run).toBe(8)
    })
  })
})

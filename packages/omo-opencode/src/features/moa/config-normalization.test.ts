import { describe, expect, test } from "bun:test"
import { MoAConfigSchema } from "@oh-my-opencode/moa-core/config"

import { normalizeMoAConfig } from "./config-normalization"

describe("normalizeMoAConfig", () => {
  test("#given parsed advisor and aggregator temperatures #when normalized #then both values are preserved", () => {
    // given
    const parsed = MoAConfigSchema.parse({
      enabled: true,
      presets: {
        test: {
          advisors: [{ name: "architect", category: "moa-architect", temperature: 0.8 }],
          aggregator: { category: "moa-aggregator", temperature: 0.2 },
        },
      },
    })

    // when
    const normalized = normalizeMoAConfig(parsed)

    // then
    expect(normalized.presets?.test?.advisors[0]?.temperature).toBe(0.8)
    expect(normalized.presets?.test?.aggregator.temperature).toBe(0.2)
  })
})

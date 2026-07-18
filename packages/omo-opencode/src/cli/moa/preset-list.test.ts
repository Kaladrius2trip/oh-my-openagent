import { describe, expect, test } from "bun:test"
import { buildPresetRows } from "./preset-list"

function customPreset(description: string) {
  return {
    description,
    advisors: [{ name: "one", category: "custom", tool_policy: "none" }],
    aggregator: { category: "custom" },
  }
}

describe("buildPresetRows", () => {
  test("#given built-ins and custom preset #when listed #then union is deterministic and active row is marked", () => {
    // given
    const config = {
      default_preset: "z-custom",
      presets: { "z-custom": customPreset("Custom preset") },
    }

    // when
    const first = buildPresetRows(config)
    const second = buildPresetRows(config)

    // then
    expect(first).toEqual(second)
    expect(first.map((row) => row.name)).toEqual([...first.map((row) => row.name)].sort())
    expect(first.find((row) => row.name === "architecture-balanced")?.provenance).toBe("built-in")
    expect(first.find((row) => row.name === "z-custom")).toMatchObject({
      active: true,
      provenance: "custom",
      advisorCount: 1,
      description: "Custom preset",
    })
  })

  test("#given user preset with built-in name #when listed #then exact-name entry is an override", () => {
    // given
    const config = {
      default_preset: "budget",
      presets: { budget: { ...customPreset("Replacement"), enabled: false } },
    }

    // when
    const row = buildPresetRows(config).find((candidate) => candidate.name === "budget")

    // then
    expect(row).toEqual({
      name: "budget",
      active: true,
      provenance: "override",
      disabled: true,
      advisorCount: 1,
      description: "Replacement",
    })
  })
})

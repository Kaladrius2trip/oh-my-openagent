import { describe, expect, test } from "bun:test"
import type { MoAConfig, MoAPresetConfig } from "./types"
import { describeMoAToolExposure } from "./tool-exposure"

const preset: MoAPresetConfig = {
  advisors: [{ name: "researcher", category: "moa-researcher", tool_policy: "read_only" }],
  aggregator: { category: "moa-aggregator" },
}

function exposedTools(config: MoAConfig): readonly string[] {
  return describeMoAToolExposure(preset, config).advisorToolsExposed
}

describe("read_only tool group resolution", () => {
  test("#given a configured hard-denied tool and list #when resolved #then the denied tool is stripped and list remains", () => {
    const tools = exposedTools({ tool_groups: { read_only: ["read", "edit", "list"] } })

    expect(tools).toEqual(["read", "list"])
  })

  test("#given no read_only group #when resolved #then the closed fallback is used", () => {
    const tools = exposedTools({})

    expect(tools).toEqual(["read", "grep", "glob"])
  })

  test("#given a group emptied by hard-deny filtering #when resolved #then the closed fallback is used", () => {
    const tools = exposedTools({ tool_groups: { read_only: ["write", "bash"] } })

    expect(tools).toEqual(["read", "grep", "glob"])
  })
})

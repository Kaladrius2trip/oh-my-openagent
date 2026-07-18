import type { MoAPresetConfig, MoAToolPolicy } from "./types"

export const MOA_READ_ONLY_TOOL_NAMES = ["read", "grep", "glob"] as const

export type MoAReadOnlyToolName = (typeof MOA_READ_ONLY_TOOL_NAMES)[number]

export interface MoAToolExposure {
  readonly advisorPolicies: readonly { readonly name: string; readonly policy: MoAToolPolicy }[]
  readonly advisorToolsExposed: readonly MoAReadOnlyToolName[]
  readonly aggregatorToolsExposed: readonly []
  readonly toolsExposed: 0 | 3
}

export function describeMoAToolExposure(preset: MoAPresetConfig): MoAToolExposure {
  const advisorPolicies = preset.advisors.map((advisor) => ({
    name: advisor.name,
    policy: advisor.tool_policy ?? "none",
  }))
  const researchEnabled = advisorPolicies.some(({ policy }) => policy === "read_only")
  return {
    advisorPolicies,
    advisorToolsExposed: researchEnabled ? MOA_READ_ONLY_TOOL_NAMES : [],
    aggregatorToolsExposed: [],
    toolsExposed: researchEnabled ? 3 : 0,
  }
}

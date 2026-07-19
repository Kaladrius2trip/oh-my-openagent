import type { MoAConfig, MoAPresetConfig, MoAToolPolicy } from "./types"

export const MOA_READ_ONLY_TOOL_NAMES = ["read", "grep", "glob"] as const
export const TOOL_GROUP_HARD_DENY = [
  "write",
  "edit",
  "patch",
  "apply_patch",
  "multiedit",
  "bash",
  "task",
  "question",
  "webfetch",
  "todowrite",
] as const

const TOOL_GROUP_HARD_DENY_SET = new Set<string>(TOOL_GROUP_HARD_DENY)

export interface MoAToolExposure {
  readonly advisorPolicies: readonly { readonly name: string; readonly policy: MoAToolPolicy }[]
  readonly advisorToolsExposed: readonly string[]
  readonly aggregatorToolsExposed: readonly []
  readonly toolsExposed: number
}

export function resolveMoAResearchToolWhitelist(config: Pick<MoAConfig, "tool_groups">): readonly string[] {
  const configured = config.tool_groups?.["read_only"] ?? []
  const filtered = configured.filter((tool) => !TOOL_GROUP_HARD_DENY_SET.has(tool))
  return filtered.length > 0 ? filtered : MOA_READ_ONLY_TOOL_NAMES
}

export function describeMoAToolExposure(
  preset: MoAPresetConfig,
  config: Pick<MoAConfig, "tool_groups"> = {},
): MoAToolExposure {
  const advisorPolicies = preset.advisors.map((advisor) => ({
    name: advisor.name,
    policy: advisor.tool_policy ?? "none",
  }))
  const researchEnabled = advisorPolicies.some(({ policy }) => policy === "read_only")
  const advisorToolsExposed = researchEnabled ? resolveMoAResearchToolWhitelist(config) : []
  return {
    advisorPolicies,
    advisorToolsExposed,
    aggregatorToolsExposed: [],
    toolsExposed: advisorToolsExposed.length,
  }
}

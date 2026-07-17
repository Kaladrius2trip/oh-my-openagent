// Foundational vocabulary and configuration-shaped types for Mixture of Advisors.
// These are harness-neutral: no imports from any adapter or harness package.

export type MoARunStatus =
  | "created"
  | "resolving"
  | "advising"
  | "aggregating"
  | "completed"
  | "degraded"
  | "failed"
  | "timed_out"
  | "cancelled"

export type MoAToolPolicy = "none"

export type MoAExecutionPolicy = "consultation_only"

export const MOA_ADVISOR_MODES = ["analysis", "research", "planning", "review", "evidence-search"] as const
export type MoAAdvisorMode = (typeof MOA_ADVISOR_MODES)[number]

export const MOA_ADVISOR_ROLES = [
  "general",
  "architect",
  "validator",
  "researcher",
  "challenger",
  "skeptic",
  "security-reviewer",
] as const
export type MoAAdvisorRole = (typeof MOA_ADVISOR_ROLES)[number]

export type MoAPromptTemplateRef = `builtin:${string}` | `file://${string}`

export type MoAViolationPolicy = "fail" | "degrade" | "warn"

export type MoAContextMode = "task_only" | "recent_text" | "recent_state"

export type MoATarget = { category: string; subagent_type?: never } | { subagent_type: string; category?: never }

export type MoAAdvisorConfig = MoATarget & {
  name: string
  role?: MoAAdvisorRole
  mode?: MoAAdvisorMode
  prompt_append?: string
  maxTokens?: number
  tool_policy?: MoAToolPolicy
}

export type MoAAggregatorConfig = MoATarget & {
  prompt_append?: string
  maxTokens?: number
}

export interface MoAContextConfig {
  mode?: MoAContextMode
  max_messages?: number
  max_tokens?: number
  tool_result_preview_chars?: number
}

export interface MoADiversityConfig {
  min_distinct_providers?: number
  min_distinct_models?: number
  prefer_aggregator_provider_distinct?: boolean
  on_configured_violation?: MoAViolationPolicy
  on_effective_violation?: MoAViolationPolicy
}

export interface MoAPromptPackConfig {
  advisor_base: MoAPromptTemplateRef
  advisor_modes: Record<MoAAdvisorMode, MoAPromptTemplateRef>
  aggregator_base: MoAPromptTemplateRef
  task_envelope: MoAPromptTemplateRef
  advisor_output_contract: MoAPromptTemplateRef
  aggregator_output_contract: MoAPromptTemplateRef
}

export interface MoAPresetConfig {
  enabled?: boolean
  description?: string
  prompt_pack?: string
  execution_policy?: MoAExecutionPolicy
  advisors: MoAAdvisorConfig[]
  aggregator: MoAAggregatorConfig
  context?: MoAContextConfig
  diversity?: MoADiversityConfig
  min_successful_advisors?: number
  advisor_timeout_ms?: number
  aggregator_timeout_ms?: number
  include_failures_in_aggregation?: boolean
  return_advisor_outputs?: boolean
}

export interface MoAConfig {
  enabled?: boolean
  default_preset?: string
  default_prompt_pack?: string
  max_advisors_per_run?: number
  prompt_packs?: Record<string, MoAPromptPackConfig>
  presets?: Record<string, MoAPresetConfig>
}

/** A concrete provider/model target after runtime resolution. Model identity for
 * diversity purposes is `providerID/modelID`; `variant` never changes identity. */
export interface MoAResolvedModel {
  providerID: string
  modelID: string
  variant?: string
  reasoningEffort?: string
}

import type { MoAPresetConfig } from "../types"

/** Default preset: three-provider architecture, API and migration consultation. */
export const architectureBalancedPreset: MoAPresetConfig = {
  enabled: true,
  description: "Three-provider architecture consultation.",
  prompt_pack: "omo-hermes-derived-v2",
  execution_policy: "consultation_only",
  advisors: [
    { name: "architect", role: "architect", mode: "analysis", category: "moa-architect", tool_policy: "read_only" },
    { name: "validator", role: "validator", mode: "analysis", category: "moa-validator", tool_policy: "read_only" },
    { name: "challenger", role: "challenger", mode: "analysis", category: "moa-challenger", tool_policy: "read_only" },
  ],
  aggregator: { category: "moa-aggregator", maxTokens: 4400 },
  context: { mode: "task_only", max_messages: 12, max_tokens: 22000, tool_result_preview_chars: 4000 },
  diversity: {
    min_distinct_providers: 2,
    min_distinct_models: 2,
    prefer_aggregator_provider_distinct: true,
    on_configured_violation: "fail",
    on_effective_violation: "degrade",
  },
  min_successful_advisors: 2,
  advisor_timeout_ms: 150000,
  aggregator_timeout_ms: 150000,
  include_failures_in_aggregation: true,
  return_advisor_outputs: false,
}

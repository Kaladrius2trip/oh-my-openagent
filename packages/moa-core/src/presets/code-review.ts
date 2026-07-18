import type { MoAPresetConfig } from "../types"

/** Deep code review and regression analysis across diff, contracts and race conditions. */
export const codeReviewPreset: MoAPresetConfig = {
  enabled: true,
  description: "Deep code review and regression analysis.",
  prompt_pack: "omo-hermes-derived-v2",
  execution_policy: "consultation_only",
  advisors: [
    { name: "researcher", role: "researcher", mode: "research", category: "moa-researcher", tool_policy: "read_only" },
    { name: "validator", role: "validator", mode: "review", category: "moa-validator", tool_policy: "read_only" },
    { name: "architect", role: "architect", mode: "review", category: "moa-architect", tool_policy: "read_only" },
  ],
  aggregator: { category: "moa-aggregator", maxTokens: 4600 },
  context: { mode: "recent_text", max_messages: 18, max_tokens: 28000, tool_result_preview_chars: 5000 },
  diversity: {
    min_distinct_providers: 2,
    min_distinct_models: 2,
    prefer_aggregator_provider_distinct: false,
    on_configured_violation: "fail",
    on_effective_violation: "degrade",
  },
  min_successful_advisors: 2,
  advisor_timeout_ms: 180000,
  aggregator_timeout_ms: 180000,
  include_failures_in_aggregation: true,
  return_advisor_outputs: true,
}

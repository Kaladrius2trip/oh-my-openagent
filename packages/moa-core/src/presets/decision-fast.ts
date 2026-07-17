import type { MoAPresetConfig } from "../types"

/** Small but consequential choices with bounded latency. */
export const decisionFastPreset: MoAPresetConfig = {
  enabled: true,
  description: "Two-advisor consultation for consequential choices with bounded latency.",
  prompt_pack: "omo-hermes-derived-v1",
  execution_policy: "consultation_only",
  advisors: [
    { name: "architect", role: "architect", mode: "analysis", category: "moa-architect", tool_policy: "none" },
    { name: "validator", role: "validator", mode: "analysis", category: "moa-validator", tool_policy: "none" },
  ],
  aggregator: { category: "moa-aggregator", maxTokens: 3200 },
  context: { mode: "task_only", max_messages: 10, max_tokens: 18000, tool_result_preview_chars: 3000 },
  diversity: {
    min_distinct_providers: 2,
    min_distinct_models: 2,
    prefer_aggregator_provider_distinct: true,
    on_configured_violation: "fail",
    on_effective_violation: "degrade",
  },
  min_successful_advisors: 2,
  advisor_timeout_ms: 90000,
  aggregator_timeout_ms: 90000,
  include_failures_in_aggregation: true,
  return_advisor_outputs: false,
}

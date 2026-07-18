import type { MoAPresetConfig } from "../types"

/** Single-round adversarial planning before Prometheus or Atlas execution. */
export const planningRigorousPreset: MoAPresetConfig = {
  enabled: true,
  description: "Single-round adversarial planning before Prometheus or Atlas execution.",
  prompt_pack: "omo-hermes-derived-v2",
  execution_policy: "consultation_only",
  advisors: [
    { name: "skeptic", role: "skeptic", mode: "planning", category: "moa-skeptic", tool_policy: "none" },
    { name: "architect", role: "architect", mode: "planning", category: "moa-architect", tool_policy: "none" },
    { name: "validator", role: "validator", mode: "planning", category: "moa-validator", tool_policy: "none" },
    { name: "challenger", role: "challenger", mode: "planning", category: "moa-challenger", tool_policy: "none" },
  ],
  aggregator: { category: "moa-aggregator", maxTokens: 4800 },
  context: { mode: "task_only", max_messages: 12, max_tokens: 26000, tool_result_preview_chars: 4000 },
  diversity: {
    min_distinct_providers: 3,
    min_distinct_models: 3,
    prefer_aggregator_provider_distinct: false,
    on_configured_violation: "fail",
    on_effective_violation: "degrade",
  },
  min_successful_advisors: 3,
  advisor_timeout_ms: 180000,
  aggregator_timeout_ms: 180000,
  include_failures_in_aggregation: true,
  return_advisor_outputs: false,
}

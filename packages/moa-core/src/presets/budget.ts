import type { MoAPresetConfig } from "../types"

/** Non-critical broad second opinion across low-cost models. */
export const budgetPreset: MoAPresetConfig = {
  enabled: true,
  description: "Non-critical broad second opinion across low-cost models.",
  prompt_pack: "omo-hermes-derived-v1",
  execution_policy: "consultation_only",
  advisors: [
    { name: "budget-gpt-mini", role: "general", mode: "analysis", category: "moa-budget-gpt-mini", tool_policy: "none" },
    {
      name: "budget-gemini-flash",
      role: "general",
      mode: "analysis",
      category: "moa-budget-gemini-flash",
      tool_policy: "none",
    },
    { name: "budget-kimi", role: "general", mode: "analysis", category: "moa-budget-kimi", tool_policy: "none" },
  ],
  aggregator: { category: "moa-aggregator-fast", maxTokens: 3200 },
  context: { mode: "task_only", max_messages: 10, max_tokens: 18000, tool_result_preview_chars: 3000 },
  diversity: {
    min_distinct_providers: 2,
    min_distinct_models: 2,
    prefer_aggregator_provider_distinct: false,
    on_configured_violation: "warn",
    on_effective_violation: "degrade",
  },
  min_successful_advisors: 2,
  advisor_timeout_ms: 120000,
  aggregator_timeout_ms: 120000,
  include_failures_in_aggregation: true,
  return_advisor_outputs: false,
}

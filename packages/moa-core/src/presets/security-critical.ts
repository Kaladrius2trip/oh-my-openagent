import type { MoAPresetConfig } from "../types"

/** Auth, sandboxing, remote execution, secrets and network boundary review. */
export const securityCriticalPreset: MoAPresetConfig = {
  enabled: true,
  description: "Security-critical review of trust boundaries, secrets and abuse cases.",
  prompt_pack: "omo-hermes-derived-v2",
  execution_policy: "consultation_only",
  advisors: [
    {
      name: "security-reviewer",
      role: "security-reviewer",
      mode: "review",
      category: "moa-security-reviewer",
      tool_policy: "none",
    },
    { name: "researcher", role: "researcher", mode: "research", category: "moa-researcher", tool_policy: "none" },
    { name: "validator", role: "validator", mode: "review", category: "moa-validator", tool_policy: "none" },
    { name: "challenger", role: "challenger", mode: "research", category: "moa-challenger", tool_policy: "none" },
    { name: "skeptic", role: "skeptic", mode: "evidence-search", category: "moa-skeptic", tool_policy: "none" },
  ],
  aggregator: { category: "moa-aggregator-frontier", maxTokens: 4800 },
  context: { mode: "task_only", max_messages: 12, max_tokens: 26000, tool_result_preview_chars: 4000 },
  diversity: {
    min_distinct_providers: 3,
    min_distinct_models: 3,
    prefer_aggregator_provider_distinct: true,
    on_configured_violation: "fail",
    on_effective_violation: "fail",
  },
  min_successful_advisors: 4,
  advisor_timeout_ms: 180000,
  aggregator_timeout_ms: 180000,
  include_failures_in_aggregation: true,
  return_advisor_outputs: false,
}

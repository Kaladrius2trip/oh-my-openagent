import type { MoAPromptPackConfig } from "../../types"

export const omoHermesDerivedV2Pack: MoAPromptPackConfig = {
  advisor_base: "builtin:moa-reference-advisor-v2",
  advisor_modes: {
    analysis: "builtin:moa-mode-analysis-v1",
    research: "builtin:moa-mode-research-v2",
    planning: "builtin:moa-mode-planning-v1",
    review: "builtin:moa-mode-review-v1",
    "evidence-search": "builtin:moa-mode-evidence-search-v2",
  },
  aggregator_base: "builtin:moa-consult-aggregator-v1",
  task_envelope: "builtin:moa-task-envelope-v1",
  advisor_output_contract: "builtin:moa-advisor-report-v1",
  aggregator_output_contract: "builtin:moa-decision-bundle-v1",
}

export const DEFAULT_PROMPT_PACK_ID = "omo-hermes-derived-v2"

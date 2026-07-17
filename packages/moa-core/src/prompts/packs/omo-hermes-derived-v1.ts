import type { MoAPromptPackConfig } from "../../types"

/** Built-in prompt pack: Hermes advisory semantics adapted to OMO single-writer ownership. */
export const omoHermesDerivedV1Pack: MoAPromptPackConfig = {
  advisor_base: "builtin:moa-reference-advisor-v1",
  advisor_modes: {
    analysis: "builtin:moa-mode-analysis-v1",
    research: "builtin:moa-mode-research-v1",
    planning: "builtin:moa-mode-planning-v1",
    review: "builtin:moa-mode-review-v1",
    "evidence-search": "builtin:moa-mode-evidence-search-v1",
  },
  aggregator_base: "builtin:moa-consult-aggregator-v1",
  task_envelope: "builtin:moa-task-envelope-v1",
  advisor_output_contract: "builtin:moa-advisor-report-v1",
  aggregator_output_contract: "builtin:moa-decision-bundle-v1",
}

export const DEFAULT_PROMPT_PACK_ID = "omo-hermes-derived-v1"

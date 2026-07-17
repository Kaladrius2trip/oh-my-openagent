import type { MoAPromptTemplate } from "../types"

export const aggregationEnvelopeV1: MoAPromptTemplate = {
  id: "builtin:moa-aggregation-envelope-v1",
  version: "1.1",
  content: `<omo_moa_aggregation version="1">
  <run>
    <run_id>{{RUN_ID}}</run_id>
    <preset>{{PRESET_NAME}}</preset>
    <prompt_pack>{{PROMPT_PACK_ID}}</prompt_pack>
    <aggregator_target>{{AGGREGATOR_TARGET}}</aggregator_target>
  </run>

  <objective>
{{ORIGINAL_TASK}}
  </objective>

  <normalized_constraints>
{{NORMALIZED_CONSTRAINTS_OR_NONE}}
  </normalized_constraints>

  <current_state mode="{{CONTEXT_MODE}}" truncated="{{CONTEXT_TRUNCATED}}">
{{SANITIZED_CONTEXT}}
  </current_state>

  <diversity>
    <configured_providers>{{CONFIGURED_PROVIDER_COUNT}}</configured_providers>
    <effective_providers>{{EFFECTIVE_PROVIDER_COUNT}}</effective_providers>
    <configured_models>{{CONFIGURED_MODEL_COUNT}}</configured_models>
    <effective_models>{{EFFECTIVE_MODEL_COUNT}}</effective_models>
    <outcome>{{DIVERSITY_OUTCOME}}</outcome>
  </diversity>

  <untrusted_advisor_reports>
{{DELIMITED_ADVISOR_REPORTS_AND_FAILURES}}
  </untrusted_advisor_reports>
</omo_moa_aggregation>`,
}

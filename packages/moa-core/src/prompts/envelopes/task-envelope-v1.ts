import type { MoAPromptTemplate } from "../types"

export const taskEnvelopeV1: MoAPromptTemplate = {
  id: "builtin:moa-task-envelope-v1",
  version: "1",
  content: `<omo_moa_task version="1">
  <run>
    <run_id>{{RUN_ID}}</run_id>
    <preset>{{PRESET_NAME}}</preset>
    <advisor>{{ADVISOR_NAME}}</advisor>
    <role>{{ADVISOR_ROLE}}</role>
    <mode>{{ADVISOR_MODE}}</mode>
    <execution_policy>consultation_only</execution_policy>
    <requested_target>{{REQUESTED_TARGET}}</requested_target>
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

  <parent_request>
Produce an independent {{ADVISOR_MODE}} report for the parent orchestrator. Return decision-support knowledge only. Do not implement, modify state, invoke tools or answer the end user directly.
  </parent_request>
</omo_moa_task>`,
}

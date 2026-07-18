import * as z from "zod"
import { MOA_ADVISOR_MODES, MOA_ADVISOR_ROLES } from "../types"

/** A prompt template reference: a versioned builtin ID or a file:// override. */
export const MoATemplateRefSchema = z
  .string()
  .regex(/^(builtin:.+|file:\/\/.+)$/, "must be a builtin: or file:// template reference")

export const MoAViolationPolicySchema = z.enum(["fail", "degrade", "warn"])

export const MoAPromptPackConfigSchema = z.object({
  advisor_base: MoATemplateRefSchema,
  advisor_modes: z.record(z.enum(MOA_ADVISOR_MODES), MoATemplateRefSchema),
  aggregator_base: MoATemplateRefSchema,
  task_envelope: MoATemplateRefSchema,
  advisor_output_contract: MoATemplateRefSchema,
  aggregator_output_contract: MoATemplateRefSchema,
})

function exactlyOneTarget(value: { category?: string; subagent_type?: string }): boolean {
  return (value.category === undefined) !== (value.subagent_type === undefined)
}

const TARGET_MESSAGE = "specify exactly one of category or subagent_type"

export const MoAAdvisorConfigSchema = z
  .object({
    name: z.string().min(1),
    role: z.enum(MOA_ADVISOR_ROLES).optional(),
    mode: z.enum(MOA_ADVISOR_MODES).optional(),
    category: z.string().min(1).optional(),
    subagent_type: z.string().min(1).optional(),
    prompt_append: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    tool_policy: z.literal("none").optional(),
  })
  .refine(exactlyOneTarget, { message: `advisor must ${TARGET_MESSAGE}` })

export const MoAAggregatorConfigSchema = z
  .object({
    category: z.string().min(1).optional(),
    subagent_type: z.string().min(1).optional(),
    prompt_append: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .refine(exactlyOneTarget, { message: `aggregator must ${TARGET_MESSAGE}` })

export const MoAContextConfigSchema = z.object({
  mode: z.enum(["task_only", "recent_text", "recent_state"]).optional(),
  max_messages: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  tool_result_preview_chars: z.number().int().nonnegative().optional(),
})

export const MoADiversityConfigSchema = z.object({
  min_distinct_providers: z.number().int().nonnegative().optional(),
  min_distinct_models: z.number().int().nonnegative().optional(),
  prefer_aggregator_provider_distinct: z.boolean().optional(),
  on_configured_violation: MoAViolationPolicySchema.optional(),
  on_effective_violation: MoAViolationPolicySchema.optional(),
})

export const MoAPresetConfigSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  prompt_pack: z.string().optional(),
  execution_policy: z.literal("consultation_only").optional(),
  advisors: z.array(MoAAdvisorConfigSchema).min(1).max(8),
  aggregator: MoAAggregatorConfigSchema,
  context: MoAContextConfigSchema.optional(),
  diversity: MoADiversityConfigSchema.optional(),
  min_successful_advisors: z.number().int().positive().optional(),
  advisor_timeout_ms: z.number().int().positive().optional(),
  aggregator_timeout_ms: z.number().int().positive().optional(),
  include_failures_in_aggregation: z.boolean().optional(),
  return_advisor_outputs: z.boolean().optional(),
})

export const MoAConfigSchema = z.object({
  enabled: z.boolean().default(false),
  default_preset: z.string().default("architecture-balanced"),
  default_prompt_pack: z.string().default("omo-hermes-derived-v1"),
  max_advisors_per_run: z.number().int().min(1).max(8).default(8),
  prompt_packs: z.record(z.string(), MoAPromptPackConfigSchema).optional(),
  presets: z.record(z.string(), MoAPresetConfigSchema).optional(),
})

export type MoAConfigInput = z.input<typeof MoAConfigSchema>
export type MoAConfigParsed = z.infer<typeof MoAConfigSchema>
export type MoAPresetConfigParsed = z.infer<typeof MoAPresetConfigSchema>

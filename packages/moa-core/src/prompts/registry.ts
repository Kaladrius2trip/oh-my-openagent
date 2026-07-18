import type { MoAAdvisorMode, MoAAdvisorRole, MoAPromptPackConfig, MoAPromptTemplateRef } from "../types"
import { consultAggregatorV1 } from "./base/consult-aggregator-v1"
import { referenceAdvisorV1 } from "./base/reference-advisor-v1"
import { referenceAdvisorV2 } from "./base/reference-advisor-v2"
import { advisorReportV1 } from "./contracts/advisor-report-v1"
import { decisionBundleV1 } from "./contracts/decision-bundle-v1"
import { aggregationEnvelopeV1 } from "./envelopes/aggregation-envelope-v1"
import { taskEnvelopeV1 } from "./envelopes/task-envelope-v1"
import { MODE_TEMPLATES_V1 } from "./modes/modes-v1"
import { MODE_TEMPLATES_V2 } from "./modes/modes-v2"
import { OMO_HERMES_DERIVED_V1_PACK_ID, omoHermesDerivedV1Pack } from "./packs/omo-hermes-derived-v1"
import { DEFAULT_PROMPT_PACK_ID, omoHermesDerivedV2Pack } from "./packs/omo-hermes-derived-v2"
import { TOOL_POLICY_TEMPLATES_V1 } from "./policies/tool-policy-v1"
import { ROLE_TEMPLATES_V1 } from "./roles/roles-v1"
import type { MoAPromptTemplate } from "./types"

export { DEFAULT_PROMPT_PACK_ID }

const BUILTIN_TEMPLATE_LIST: readonly MoAPromptTemplate[] = [
  referenceAdvisorV1,
  referenceAdvisorV2,
  consultAggregatorV1,
  taskEnvelopeV1,
  aggregationEnvelopeV1,
  advisorReportV1,
  decisionBundleV1,
  ...Object.values(MODE_TEMPLATES_V1),
  ...MODE_TEMPLATES_V2,
  ...Object.values(ROLE_TEMPLATES_V1),
  ...Object.values(TOOL_POLICY_TEMPLATES_V1),
]

export const BUILTIN_TEMPLATES: Record<string, MoAPromptTemplate> = Object.fromEntries(
  BUILTIN_TEMPLATE_LIST.map((template) => [template.id, template]),
)

export const BUILTIN_PROMPT_PACKS: Record<string, MoAPromptPackConfig> = {
  [OMO_HERMES_DERIVED_V1_PACK_ID]: omoHermesDerivedV1Pack,
  [DEFAULT_PROMPT_PACK_ID]: omoHermesDerivedV2Pack,
}

export type PromptFileReader = (filePath: string) => string

export interface ResolveTemplateOptions {
  /** Injected reader for `file://` overrides; the harness enforces path policy. */
  fileReader?: PromptFileReader
}

export function resolveTemplateRef(ref: MoAPromptTemplateRef, options: ResolveTemplateOptions = {}): MoAPromptTemplate {
  if (ref.startsWith("builtin:")) {
    const template = BUILTIN_TEMPLATES[ref]
    if (template === undefined) throw new Error(`Unknown builtin prompt template: ${ref}`)
    return template
  }
  if (ref.startsWith("file://")) {
    if (options.fileReader === undefined) {
      throw new Error(`Prompt override ${ref} requires an injected file reader`)
    }
    const path = ref.slice("file://".length)
    let content: string
    try {
      content = options.fileReader(path)
    } catch (cause) {
      throw new Error(`Unreadable prompt override: ${ref}`, { cause })
    }
    return { id: ref, version: "override", content }
  }
  throw new Error(`Invalid prompt template ref: ${ref}`)
}

export interface ResolvedPromptPack {
  id: string
  advisorBase: MoAPromptTemplate
  advisorModes: Record<MoAAdvisorMode, MoAPromptTemplate>
  aggregatorBase: MoAPromptTemplate
  taskEnvelope: MoAPromptTemplate
  aggregationEnvelope: MoAPromptTemplate
  advisorOutputContract: MoAPromptTemplate
  aggregatorOutputContract: MoAPromptTemplate
  roleTemplates: Record<MoAAdvisorRole, MoAPromptTemplate>
}

export interface ResolvePromptPackOptions extends ResolveTemplateOptions {
  /** Additional user-registered packs (for example from a validated file:// pack). */
  extraPacks?: Record<string, MoAPromptPackConfig>
}

export function resolvePromptPack(packId: string, options: ResolvePromptPackOptions = {}): ResolvedPromptPack {
  const config = options.extraPacks?.[packId] ?? BUILTIN_PROMPT_PACKS[packId]
  if (config === undefined) throw new Error(`Unknown prompt pack: ${packId}`)

  const modeEntries = Object.entries(config.advisor_modes) as [MoAAdvisorMode, MoAPromptTemplateRef][]
  const advisorModes = Object.fromEntries(
    modeEntries.map(([mode, ref]) => [mode, resolveTemplateRef(ref, options)]),
  ) as Record<MoAAdvisorMode, MoAPromptTemplate>

  return {
    id: packId,
    advisorBase: resolveTemplateRef(config.advisor_base, options),
    advisorModes,
    aggregatorBase: resolveTemplateRef(config.aggregator_base, options),
    taskEnvelope: resolveTemplateRef(config.task_envelope, options),
    aggregationEnvelope: aggregationEnvelopeV1,
    advisorOutputContract: resolveTemplateRef(config.advisor_output_contract, options),
    aggregatorOutputContract: resolveTemplateRef(config.aggregator_output_contract, options),
    roleTemplates: ROLE_TEMPLATES_V1,
  }
}

/** Project-level config may select a pack but may not replace a built-in template ID. */
export function assertNoBuiltinShadow(userTemplateIds: readonly string[]): void {
  for (const id of userTemplateIds) {
    if (id.startsWith("builtin:")) {
      throw new Error(`Project config cannot shadow a built-in prompt template ID: ${id}`)
    }
  }
}

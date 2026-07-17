import { createHash } from "node:crypto"
import type { MoAAdvisorMode, MoAAdvisorRole } from "../types"
import { escapeEnvelopeValue, renderTemplate } from "./placeholder-engine"
import type { ResolvedPromptPack } from "./registry"

export interface ComposedPrompt {
  /** Full prompt text sent to the child. */
  text: string
  /** SHA-256 of the trusted, task-independent system portion. */
  systemHash: string
  /** Template IDs that contributed to the composition, for run metadata. */
  templateIds: string[]
}

export interface SanitizedContextView {
  mode: string
  truncated: boolean
  text: string
}

export interface ComposeAdvisorPromptInput {
  runId: string
  presetName: string
  advisorName: string
  role: MoAAdvisorRole
  mode: MoAAdvisorMode
  requestedTarget: string
  originalTask: string
  constraints?: string
  context: SanitizedContextView
  promptAppend?: string
}

export interface AdvisorReportEntry {
  name: string
  role: string
  status: string
  requestedModel: string
  finalModel: string
  fallbackCount: number
  truncated?: boolean
  output?: string
  errorCategory?: string
}

export interface ComposeAggregatorPromptInput {
  runId: string
  presetName: string
  promptPackId: string
  aggregatorTarget: string
  originalTask: string
  constraints?: string
  context: SanitizedContextView
  diversity: {
    configuredProviders: number
    effectiveProviders: number
    configuredModels: number
    effectiveModels: number
    outcome: string
  }
  advisorReports: readonly AdvisorReportEntry[]
  promptAppend?: string
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function joinBlocks(blocks: readonly (string | undefined)[]): string {
  return blocks.filter((block): block is string => block !== undefined && block.length > 0).join("\n\n")
}

function roleHintBlock(promptAppend: string | undefined): string | undefined {
  if (promptAppend === undefined || promptAppend.trim().length === 0) return undefined
  return `<role_hint>\n${escapeEnvelopeValue(promptAppend)}\n</role_hint>`
}

export function composeAdvisorPrompt(pack: ResolvedPromptPack, input: ComposeAdvisorPromptInput): ComposedPrompt {
  const base = pack.advisorBase.content
  const modeTemplate = pack.advisorModes[input.mode]
  const roleTemplate = pack.roleTemplates[input.role]
  const contract = pack.advisorOutputContract.content

  const envelope = renderTemplate(pack.taskEnvelope.content, {
    RUN_ID: input.runId,
    PRESET_NAME: input.presetName,
    ADVISOR_NAME: input.advisorName,
    ADVISOR_ROLE: input.role,
    ADVISOR_MODE: input.mode,
    REQUESTED_TARGET: escapeEnvelopeValue(input.requestedTarget),
    ORIGINAL_TASK: escapeEnvelopeValue(input.originalTask),
    NORMALIZED_CONSTRAINTS_OR_NONE: escapeEnvelopeValue(input.constraints ?? "None"),
    CONTEXT_MODE: input.context.mode,
    CONTEXT_TRUNCATED: String(input.context.truncated),
    SANITIZED_CONTEXT: escapeEnvelopeValue(input.context.text),
  })

  const systemPortion = joinBlocks([base, modeTemplate.content, roleTemplate.content, contract])
  const text = joinBlocks([base, modeTemplate.content, roleTemplate.content, roleHintBlock(input.promptAppend), envelope, contract])

  return {
    text,
    systemHash: sha256(systemPortion),
    templateIds: [pack.advisorBase.id, modeTemplate.id, roleTemplate.id, pack.taskEnvelope.id, pack.advisorOutputContract.id],
  }
}

function renderAdvisorReport(entry: AdvisorReportEntry): string {
  const attributes = [
    `name="${escapeEnvelopeValue(entry.name)}"`,
    `role="${escapeEnvelopeValue(entry.role)}"`,
    `status="${escapeEnvelopeValue(entry.status)}"`,
    `requested_model="${escapeEnvelopeValue(entry.requestedModel)}"`,
    `final_model="${escapeEnvelopeValue(entry.finalModel)}"`,
    `fallback_count="${entry.fallbackCount}"`,
    `truncated="${entry.truncated === true}"`,
  ].join(" ")
  const body =
    entry.status === "completed" && entry.output !== undefined
      ? escapeEnvelopeValue(entry.output)
      : `advisor did not produce a report (error category: ${escapeEnvelopeValue(entry.errorCategory ?? "unknown")})`
  return `<advisor_report ${attributes}>\n${body}\n</advisor_report>`
}

export function composeAggregatorPrompt(pack: ResolvedPromptPack, input: ComposeAggregatorPromptInput): ComposedPrompt {
  const base = pack.aggregatorBase.content
  const contract = pack.aggregatorOutputContract.content
  const reports = input.advisorReports.map(renderAdvisorReport).join("\n")

  const envelope = renderTemplate(pack.aggregationEnvelope.content, {
    RUN_ID: input.runId,
    PRESET_NAME: input.presetName,
    PROMPT_PACK_ID: input.promptPackId,
    AGGREGATOR_TARGET: escapeEnvelopeValue(input.aggregatorTarget),
    ORIGINAL_TASK: escapeEnvelopeValue(input.originalTask),
    NORMALIZED_CONSTRAINTS_OR_NONE: escapeEnvelopeValue(input.constraints ?? "None"),
    CONTEXT_MODE: input.context.mode,
    CONTEXT_TRUNCATED: String(input.context.truncated),
    SANITIZED_CONTEXT: escapeEnvelopeValue(input.context.text),
    CONFIGURED_PROVIDER_COUNT: String(input.diversity.configuredProviders),
    EFFECTIVE_PROVIDER_COUNT: String(input.diversity.effectiveProviders),
    CONFIGURED_MODEL_COUNT: String(input.diversity.configuredModels),
    EFFECTIVE_MODEL_COUNT: String(input.diversity.effectiveModels),
    DIVERSITY_OUTCOME: input.diversity.outcome,
    DELIMITED_ADVISOR_REPORTS_AND_FAILURES: reports,
  })

  const systemPortion = joinBlocks([base, contract])
  const text = joinBlocks([base, roleHintBlock(input.promptAppend), envelope, contract])

  return {
    text,
    systemHash: sha256(systemPortion),
    templateIds: [pack.aggregatorBase.id, pack.aggregationEnvelope.id, pack.aggregatorOutputContract.id],
  }
}

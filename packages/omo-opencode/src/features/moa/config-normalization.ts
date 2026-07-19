import type {
  MoAAdvisorConfig,
  MoAAggregatorConfig,
  MoAConfig,
  MoAPresetConfig,
  MoAPromptPackConfig,
  MoAPromptTemplateRef,
  MoATarget,
} from "@oh-my-opencode/moa-core"
import type { MoAConfigParsed, MoAPresetConfigParsed } from "@oh-my-opencode/moa-core/config"

export class MoAConfigNormalizationError extends Error {
  constructor(readonly field: string, value: string) {
    super(`Invalid MoA template reference at ${field}: ${value}`)
    this.name = "MoAConfigNormalizationError"
  }
}

function templateRef(field: string, value: string): MoAPromptTemplateRef {
  if (isTemplateRef(value)) return value
  throw new MoAConfigNormalizationError(field, value)
}

function isTemplateRef(value: string): value is MoAPromptTemplateRef {
  return value.startsWith("builtin:") || value.startsWith("file://")
}

function normalizePromptPack(name: string, pack: NonNullable<MoAConfigParsed["prompt_packs"]>[string]): MoAPromptPackConfig {
  return {
    advisor_base: templateRef(`${name}.advisor_base`, pack.advisor_base),
    advisor_modes: {
      analysis: templateRef(`${name}.advisor_modes.analysis`, pack.advisor_modes.analysis),
      research: templateRef(`${name}.advisor_modes.research`, pack.advisor_modes.research),
      planning: templateRef(`${name}.advisor_modes.planning`, pack.advisor_modes.planning),
      review: templateRef(`${name}.advisor_modes.review`, pack.advisor_modes.review),
      "evidence-search": templateRef(`${name}.advisor_modes.evidence-search`, pack.advisor_modes["evidence-search"]),
    },
    aggregator_base: templateRef(`${name}.aggregator_base`, pack.aggregator_base),
    task_envelope: templateRef(`${name}.task_envelope`, pack.task_envelope),
    advisor_output_contract: templateRef(`${name}.advisor_output_contract`, pack.advisor_output_contract),
    aggregator_output_contract: templateRef(`${name}.aggregator_output_contract`, pack.aggregator_output_contract),
  }
}

function normalizeTarget(value: { readonly category?: string; readonly subagent_type?: string }): MoATarget {
  if (value.category !== undefined && value.subagent_type === undefined) return { category: value.category }
  if (value.subagent_type !== undefined && value.category === undefined) return { subagent_type: value.subagent_type }
  throw new Error("MoA target must define exactly one of category or subagent_type")
}

function normalizeAdvisor(advisor: MoAPresetConfigParsed["advisors"][number]): MoAAdvisorConfig {
  return {
    ...normalizeTarget(advisor),
    name: advisor.name,
    ...(advisor.role !== undefined ? { role: advisor.role } : {}),
    ...(advisor.mode !== undefined ? { mode: advisor.mode } : {}),
    ...(advisor.prompt_append !== undefined ? { prompt_append: advisor.prompt_append } : {}),
    ...(advisor.temperature !== undefined ? { temperature: advisor.temperature } : {}),
    ...(advisor.maxTokens !== undefined ? { maxTokens: advisor.maxTokens } : {}),
    ...(advisor.tool_policy !== undefined ? { tool_policy: advisor.tool_policy } : {}),
  }
}

function normalizeAggregator(aggregator: MoAPresetConfigParsed["aggregator"]): MoAAggregatorConfig {
  return {
    ...normalizeTarget(aggregator),
    ...(aggregator.prompt_append !== undefined ? { prompt_append: aggregator.prompt_append } : {}),
    ...(aggregator.temperature !== undefined ? { temperature: aggregator.temperature } : {}),
    ...(aggregator.maxTokens !== undefined ? { maxTokens: aggregator.maxTokens } : {}),
  }
}

function normalizePreset(preset: MoAPresetConfigParsed): MoAPresetConfig {
  return {
    ...(preset.enabled !== undefined ? { enabled: preset.enabled } : {}),
    ...(preset.description !== undefined ? { description: preset.description } : {}),
    ...(preset.prompt_pack !== undefined ? { prompt_pack: preset.prompt_pack } : {}),
    ...(preset.execution_policy !== undefined ? { execution_policy: preset.execution_policy } : {}),
    advisors: preset.advisors.map(normalizeAdvisor),
    aggregator: normalizeAggregator(preset.aggregator),
    ...(preset.context !== undefined ? { context: preset.context } : {}),
    ...(preset.diversity !== undefined ? { diversity: preset.diversity } : {}),
    ...(preset.min_successful_advisors !== undefined ? { min_successful_advisors: preset.min_successful_advisors } : {}),
    ...(preset.advisor_timeout_ms !== undefined ? { advisor_timeout_ms: preset.advisor_timeout_ms } : {}),
    ...(preset.aggregator_timeout_ms !== undefined ? { aggregator_timeout_ms: preset.aggregator_timeout_ms } : {}),
    ...(preset.include_failures_in_aggregation !== undefined ? { include_failures_in_aggregation: preset.include_failures_in_aggregation } : {}),
    ...(preset.return_advisor_outputs !== undefined ? { return_advisor_outputs: preset.return_advisor_outputs } : {}),
  }
}

export function normalizeMoAConfig(config: MoAConfigParsed): MoAConfig {
  return {
    enabled: config.enabled,
    default_preset: config.default_preset,
    default_prompt_pack: config.default_prompt_pack,
    max_advisors_per_run: config.max_advisors_per_run,
    ...(config.tool_groups !== undefined ? { tool_groups: config.tool_groups } : {}),
    ...(config.prompt_packs !== undefined ? {
      prompt_packs: Object.fromEntries(Object.entries(config.prompt_packs).map(([name, pack]) => [name, normalizePromptPack(name, pack)])),
    } : {}),
    ...(config.presets !== undefined ? {
      presets: Object.fromEntries(Object.entries(config.presets).map(([name, preset]) => [name, normalizePreset(preset)])),
    } : {}),
  }
}

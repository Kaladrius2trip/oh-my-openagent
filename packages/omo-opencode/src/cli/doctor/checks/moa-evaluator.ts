import type {
  MoAConfig,
  MoAPresetConfig,
  MoATarget,
} from "@oh-my-opencode/moa-core"
import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import { MoAConfigSchema } from "@oh-my-opencode/moa-core/config"
import { evaluateConfiguredDiversity, type MoADiversityCheck } from "@oh-my-opencode/moa-core/diversity"
import { validatePreset } from "@oh-my-opencode/moa-core/presets"
import { CategoriesConfigSchema, type CategoriesConfig } from "../../../config/schema/categories"
import { normalizeMoAConfig } from "../../../features/moa/config-normalization"
import { predictFallbackDiversity } from "../../../features/moa/diversity-prediction"
import { buildFallbackChainFromModels } from "../../../shared/fallback-chain-from-models"
import { normalizeFallbackModels } from "../../../shared/model-resolver"
import { parseModelString } from "../../../shared/model-string-parser"

export type RawMoAConfig = {
  readonly moa?: unknown
  readonly categories?: unknown
}

export type MoAValidationIssue = {
  readonly code: string
  readonly title: string
  readonly message: string
  readonly affects: readonly string[]
}

export type MoAEvaluationDependencies = {
  readonly builtinCategories: CategoriesConfig
  readonly builtinPresets: Readonly<Record<string, MoAPresetConfig>>
  readonly knownModels?: ReadonlySet<string>
  readonly presetName?: string
  readonly supportsTemperature?: (model: string) => boolean | undefined
}

export type MoAConfigEvaluation = {
  readonly valid: boolean
  readonly enabled: boolean
  readonly presetName: string
  readonly preset?: MoAPresetConfig
  readonly config?: MoAConfig
  readonly targets: readonly ResolvedMoATarget[]
  readonly configuredDiversity?: MoADiversityCheck
  readonly fallbackPrediction?: MoADiversityCheck
  readonly errors: readonly MoAValidationIssue[]
  readonly warnings: readonly MoAValidationIssue[]
}

type TargetResolution =
  | { readonly ok: true; readonly target: ResolvedMoATarget }
  | { readonly ok: false; readonly issue: MoAValidationIssue }

function issue(code: string, title: string, message: string, affects: readonly string[] = []): MoAValidationIssue {
  return { code, title, message, affects }
}

function schemaIssues(prefix: string, errors: readonly { readonly message: string; readonly path: readonly PropertyKey[] }[]): MoAValidationIssue[] {
  return errors.map((error) => issue(
    "schema",
    "Invalid MoA configuration",
    `${prefix}${error.path.length > 0 ? `.${error.path.map(String).join(".")}` : ""}: ${error.message}`,
  ))
}

function flattenFallbackChain(category: CategoriesConfig[string], providerID: string): ResolvedMoATarget["fallbackChain"] {
  const chain = buildFallbackChainFromModels(normalizeFallbackModels(category.fallback_models), providerID) ?? []
  return chain.flatMap((entry) => entry.providers.map((candidateProvider) => ({
    providerID: candidateProvider,
    modelID: entry.model,
    ...(entry.variant === undefined ? {} : { variant: entry.variant }),
    ...(entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort }),
  })))
}

function resolveTarget(target: MoATarget, label: string, categories: CategoriesConfig): TargetResolution {
  if ("subagent_type" in target) {
    return { ok: false, issue: issue("invalid_target", "Invalid MoA target", `${label} subagent target cannot be checked offline`, [label]) }
  }
  const category = categories[target.category]
  if (category?.disable === true) {
    return { ok: false, issue: issue("invalid_target", "Invalid MoA target", `${label} category "${target.category}" is disabled`, [label]) }
  }
  if (category?.model === undefined) {
    return { ok: false, issue: issue("invalid_target", "Invalid MoA target", `${label} category "${target.category}" has no model`, [label]) }
  }
  const model = parseModelString(category.model)
  if (model === undefined) {
    return { ok: false, issue: issue("invalid_target", "Invalid MoA target", `${label} category "${target.category}" has invalid model "${category.model}"`, [label]) }
  }
  return {
    ok: true,
    target: {
      requested: { category: target.category },
      agent: "sisyphus-junior",
      category: target.category,
      model,
      fallbackChain: flattenFallbackChain(category, model.providerID),
    },
  }
}

function temperatureWarnings(
  preset: MoAPresetConfig,
  categories: CategoriesConfig,
  supportsTemperature: MoAEvaluationDependencies["supportsTemperature"],
): MoAValidationIssue[] {
  if (supportsTemperature === undefined) return []
  const slots = [
    ...preset.advisors.map((advisor) => ({
      label: `advisor:${advisor.name}`,
      temperature: advisor.temperature,
      category: "category" in advisor ? advisor.category : undefined,
    })),
    {
      label: "aggregator",
      temperature: preset.aggregator.temperature,
      category: "category" in preset.aggregator ? preset.aggregator.category : undefined,
    },
  ]
  return slots.flatMap((slot) => {
    if (slot.temperature === undefined || slot.category === undefined) return []
    const model = categories[slot.category]?.model
    if (model === undefined || supportsTemperature(model) !== false) return []
    return [issue(
      "unsupported_temperature",
      "Configured MoA temperature is unsupported",
      `${slot.label} sets temperature ${slot.temperature} for ${model}, whose capability metadata disables temperature.`,
      [slot.label],
    )]
  })
}

function modelHintWarnings(targets: readonly ResolvedMoATarget[], knownModels: ReadonlySet<string> | undefined): MoAValidationIssue[] {
  if (knownModels === undefined) return []
  const configuredModels = new Set(targets.flatMap((target) => [target.model, ...target.fallbackChain]
    .map((model) => `${model.providerID}/${model.modelID}`)))
  return [...configuredModels]
    .filter((model) => !knownModels.has(model))
    .map((model) => issue(
      "unknown_model_hint",
      "Model is absent from local cache",
      `${model} is absent from the optional provider cache. The cache may be stale.`,
      [model],
    ))
}

function failedEvaluation(errors: readonly MoAValidationIssue[], presetName: string, enabled = false): MoAConfigEvaluation {
  return { valid: false, enabled, presetName, targets: [], errors, warnings: [] }
}

export function evaluateMoAConfig(candidate: RawMoAConfig, dependencies: MoAEvaluationDependencies): MoAConfigEvaluation {
  const parsedMoA = MoAConfigSchema.safeParse(candidate.moa ?? {})
  const parsedCategories = CategoriesConfigSchema.safeParse(candidate.categories ?? {})
  const parseErrors = [
    ...(parsedMoA.success ? [] : schemaIssues("moa", parsedMoA.error.issues)),
    ...(parsedCategories.success ? [] : schemaIssues("categories", parsedCategories.error.issues)),
  ]
  if (!parsedMoA.success || !parsedCategories.success) {
    return failedEvaluation(parseErrors, dependencies.presetName ?? "architecture-balanced")
  }

  const config = normalizeMoAConfig(parsedMoA.data)
  const presetName = dependencies.presetName ?? config.default_preset ?? "architecture-balanced"
  const preset = { ...dependencies.builtinPresets, ...config.presets }[presetName]
  if (preset === undefined) {
    return failedEvaluation([
      issue("missing_preset", "Missing MoA preset", `Default preset "${presetName}" is missing.`, [presetName]),
    ], presetName, config.enabled === true)
  }
  if (preset.enabled === false) {
    return failedEvaluation([
      issue("disabled_preset", "Disabled MoA preset", `Preset "${presetName}" is disabled.`, [presetName]),
    ], presetName, config.enabled === true)
  }

  const structuralErrors = validatePreset(preset, { maxAdvisors: config.max_advisors_per_run })
    .map((error) => issue(error.code, "Invalid MoA preset", error.message, [presetName]))
  if (structuralErrors.length > 0) {
    return { ...failedEvaluation(structuralErrors, presetName, config.enabled === true), preset, config }
  }

  const categories = { ...dependencies.builtinCategories, ...parsedCategories.data }
  const advisorResolutions = preset.advisors.map((advisor) => resolveTarget(advisor, `advisor:${advisor.name}`, categories))
  const aggregatorResolution = resolveTarget(preset.aggregator, "aggregator", categories)
  const targetErrors = [
    ...advisorResolutions.filter((resolution) => !resolution.ok).map((resolution) => resolution.issue),
    ...(aggregatorResolution.ok ? [] : [aggregatorResolution.issue]),
  ]
  if (targetErrors.length > 0) {
    return { ...failedEvaluation(targetErrors, presetName, config.enabled === true), preset, config }
  }

  const targets = advisorResolutions.flatMap((resolution) => resolution.ok ? [resolution.target] : [])
  const allTargets = aggregatorResolution.ok ? [...targets, aggregatorResolution.target] : targets
  const warnings = [
    ...temperatureWarnings(preset, categories, dependencies.supportsTemperature),
    ...modelHintWarnings(allTargets, dependencies.knownModels),
  ]
  const configuredDiversity = evaluateConfiguredDiversity(targets.map((target) => target.model), preset.diversity ?? {})
  const errors = configuredDiversity.outcome === "failed"
    ? [issue("configured_diversity", "Configured MoA diversity fails", configuredDiversity.warning ?? "Configured diversity fails.", [presetName])]
    : []
  if (configuredDiversity.warning !== undefined && configuredDiversity.outcome !== "failed") {
    warnings.push(issue("configured_diversity", "Configured MoA diversity warning", configuredDiversity.warning, [presetName]))
  }
  const fallbackPrediction = predictFallbackDiversity(targets, preset.diversity ?? {})
  if (fallbackPrediction.outcome !== "satisfied") {
    warnings.push(issue("fallback_collapse", "MoA fallback diversity may collapse", fallbackPrediction.warning ?? "Fallback diversity may collapse.", [presetName]))
  }

  return {
    valid: errors.length === 0,
    enabled: config.enabled === true,
    presetName,
    preset,
    config,
    targets,
    configuredDiversity,
    fallbackPrediction,
    errors,
    warnings,
  }
}

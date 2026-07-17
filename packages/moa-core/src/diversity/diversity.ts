import type { MoADiversityConfig, MoAResolvedModel, MoAViolationPolicy } from "../types"

export type MoADiversityOutcome = "satisfied" | "degraded" | "failed"

export interface MoADiversityCounts {
  providers: number
  models: number
}

export interface MoADiversityCheck {
  counts: MoADiversityCounts
  meetsProviders: boolean
  meetsModels: boolean
  satisfied: boolean
  policy: MoAViolationPolicy
  outcome: MoADiversityOutcome
  warning?: string
}

export interface MoAAdvisorSettlement {
  name: string
  status: "completed" | "failed" | "timed_out" | "cancelled"
  model: MoAResolvedModel
}

/** Model identity for diversity ignores variant: `provider/model`. */
function modelIdentity(model: MoAResolvedModel): string {
  return `${model.providerID}/${model.modelID}`
}

export function countDistinct(models: readonly MoAResolvedModel[]): MoADiversityCounts {
  const providers = new Set<string>()
  const identities = new Set<string>()
  for (const model of models) {
    providers.add(model.providerID)
    identities.add(modelIdentity(model))
  }
  return { providers: providers.size, models: identities.size }
}

function applyPolicy(
  satisfied: boolean,
  policy: MoAViolationPolicy,
  counts: MoADiversityCounts,
  minProviders: number,
  minModels: number,
): { outcome: MoADiversityOutcome; warning?: string } {
  if (satisfied) return { outcome: "satisfied" }
  const warning = `diversity below threshold: providers ${counts.providers}/${minProviders}, models ${counts.models}/${minModels}`
  if (policy === "fail") return { outcome: "failed", warning }
  if (policy === "degrade") return { outcome: "degraded", warning }
  return { outcome: "satisfied", warning }
}

function check(
  models: readonly MoAResolvedModel[],
  config: MoADiversityConfig,
  policy: MoAViolationPolicy,
): MoADiversityCheck {
  const counts = countDistinct(models)
  const minProviders = config.min_distinct_providers ?? 1
  const minModels = config.min_distinct_models ?? 1
  const meetsProviders = counts.providers >= minProviders
  const meetsModels = counts.models >= minModels
  const satisfied = meetsProviders && meetsModels
  const { outcome, warning } = applyPolicy(satisfied, policy, counts, minProviders, minModels)
  return { counts, meetsProviders, meetsModels, satisfied, policy, outcome, warning }
}

export function evaluateConfiguredDiversity(
  advisorModels: readonly MoAResolvedModel[],
  config: MoADiversityConfig,
): MoADiversityCheck {
  return check(advisorModels, config, config.on_configured_violation ?? "fail")
}

export function evaluateEffectiveDiversity(
  settledAdvisors: readonly MoAAdvisorSettlement[],
  config: MoADiversityConfig,
): MoADiversityCheck {
  const successfulModels = settledAdvisors.filter((advisor) => advisor.status === "completed").map((advisor) => advisor.model)
  return check(successfulModels, config, config.on_effective_violation ?? "degrade")
}

export interface EvaluateDiversityInput {
  configuredAdvisorModels: readonly MoAResolvedModel[]
  settledAdvisors: readonly MoAAdvisorSettlement[]
  aggregatorModel?: MoAResolvedModel
  config: MoADiversityConfig
}

export interface MoADiversityEvaluation {
  configured: MoADiversityCheck
  effective: MoADiversityCheck
  configuredProviders: number
  configuredModels: number
  effectiveProviders: number
  effectiveModels: number
  outcome: MoADiversityOutcome
  warnings: string[]
}

function combineOutcome(configured: MoADiversityOutcome, effective: MoADiversityOutcome): MoADiversityOutcome {
  if (configured === "failed" || effective === "failed") return "failed"
  if (configured === "degraded" || effective === "degraded") return "degraded"
  return "satisfied"
}

/** Evaluate configured and effective diversity together. The aggregator model is
 * never counted toward advisor diversity; it only informs the optional
 * aggregator-provider-distinct preference warning. */
export function evaluateDiversity(input: EvaluateDiversityInput): MoADiversityEvaluation {
  const configured = evaluateConfiguredDiversity(input.configuredAdvisorModels, input.config)
  const effective = evaluateEffectiveDiversity(input.settledAdvisors, input.config)
  const warnings: string[] = []
  if (configured.warning !== undefined) warnings.push(`configured: ${configured.warning}`)
  if (effective.warning !== undefined) warnings.push(`effective: ${effective.warning}`)

  if (input.config.prefer_aggregator_provider_distinct === true && input.aggregatorModel !== undefined) {
    const advisorProviders = new Set(input.settledAdvisors.map((advisor) => advisor.model.providerID))
    if (advisorProviders.has(input.aggregatorModel.providerID)) {
      warnings.push(`aggregator provider ${input.aggregatorModel.providerID} overlaps an advisor provider`)
    }
  }

  return {
    configured,
    effective,
    configuredProviders: configured.counts.providers,
    configuredModels: configured.counts.models,
    effectiveProviders: effective.counts.providers,
    effectiveModels: effective.counts.models,
    outcome: combineOutcome(configured.outcome, effective.outcome),
    warnings,
  }
}

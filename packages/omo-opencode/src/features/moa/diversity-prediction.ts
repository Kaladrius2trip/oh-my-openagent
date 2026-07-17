import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import {
  evaluateEffectiveDiversity,
  type MoADiversityCheck,
} from "@oh-my-opencode/moa-core/diversity"
import type { MoADiversityConfig } from "@oh-my-opencode/moa-core"
import type { MoAResolvedModel } from "@oh-my-opencode/moa-core"

function modelIdentity(model: MoAResolvedModel): string {
  return `${model.providerID}/${model.modelID}`
}

function candidateModels(target: ResolvedMoATarget): readonly MoAResolvedModel[] {
  return [target.model, ...target.fallbackChain]
}

function findSharedModel(candidates: readonly (readonly MoAResolvedModel[])[]): readonly MoAResolvedModel[] | undefined {
  const first = candidates[0]
  if (first === undefined) return undefined
  for (const model of first) {
    const identity = modelIdentity(model)
    if (candidates.every((chain) => chain.some((candidate) => modelIdentity(candidate) === identity))) {
      return candidates.map(() => model)
    }
  }
  return undefined
}

function findSharedProvider(candidates: readonly (readonly MoAResolvedModel[])[]): readonly MoAResolvedModel[] | undefined {
  const first = candidates[0]
  if (first === undefined) return undefined
  for (const providerID of new Set(first.map((model) => model.providerID))) {
    const selected: MoAResolvedModel[] = []
    for (const chain of candidates) {
      const model = chain.find((candidate) => candidate.providerID === providerID)
      if (model === undefined) break
      selected.push(model)
    }
    if (selected.length === candidates.length) return selected
  }
  return undefined
}

function evaluate(models: readonly MoAResolvedModel[], config: MoADiversityConfig): MoADiversityCheck {
  return evaluateEffectiveDiversity(models.map((model, index) => ({
    name: `advisor-${index + 1}`,
    status: "completed",
    model,
  })), config)
}

export function predictFallbackDiversity(
  targets: readonly ResolvedMoATarget[],
  config: MoADiversityConfig,
): MoADiversityCheck {
  const candidates = targets.map(candidateModels)
  const predictedModels = findSharedModel(candidates)
    ?? findSharedProvider(candidates)
    ?? targets.map((target) => target.model)
  return evaluate(predictedModels, config)
}

import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import type { MoAResolvedModel, MoATarget } from "@oh-my-opencode/moa-core"
import type { CategoriesConfig } from "../../config/schema"
import type { FallbackEntry } from "../../shared/model-requirements"
import { resolveCategoryExecution } from "../../tools/delegate-task/category-resolver"
import { resolveSubagentAgentMatch } from "../../tools/delegate-task/subagent-agent-match"
import { resolveSubagentModel } from "../../tools/delegate-task/subagent-model-resolution"
import type { ExecutorContext } from "../../tools/delegate-task/executor-types"

type AgentMode = "subagent" | "primary" | "all" | undefined

export interface MoATargetResolutionSource {
  readonly agent: string
  readonly agentMode?: AgentMode
  readonly category?: string
  readonly model: MoAResolvedModel
  readonly fallbackChain: readonly FallbackEntry[]
}

export interface MoATargetResolutionDeps {
  readonly resolveCategoryExecutionFn: (category: string) => Promise<MoATargetResolutionSource>
  readonly resolveSubagentModelFn: (subagentType: string) => Promise<MoATargetResolutionSource>
}

const BUILTIN_MOA_CATEGORIES: CategoriesConfig = {
  "moa-architect": {
    model: "anthropic/claude-opus-4-7",
    variant: "max",
    fallback_models: [
      { model: "openai/gpt-5.5", reasoningEffort: "high" },
      { model: "google/gemini-3.1-pro", variant: "high" },
    ],
  },
  "moa-validator": {
    model: "openai/gpt-5.6-sol",
    reasoningEffort: "xhigh",
    fallback_models: [
      { model: "anthropic/claude-opus-4-7", variant: "max" },
      { model: "google/gemini-3.1-pro", variant: "high" },
    ],
  },
  "moa-researcher": {
    model: "openai/gpt-5.6-terra",
    reasoningEffort: "xhigh",
    fallback_models: [
      { model: "google/gemini-3.1-pro", variant: "high" },
      { model: "anthropic/claude-opus-4-7", variant: "max" },
    ],
  },
  "moa-challenger": {
    model: "google/gemini-3.1-pro",
    variant: "high",
    fallback_models: [
      { model: "anthropic/claude-opus-4-7", variant: "max" },
      { model: "openai/gpt-5.5", reasoningEffort: "high" },
    ],
  },
  "moa-skeptic": {
    model: "openai/gpt-5.6-luna",
    reasoningEffort: "high",
    fallback_models: ["openai/gpt-5.4-mini", "anthropic/claude-sonnet-4-6"],
  },
  "moa-security-reviewer": {
    model: "anthropic/claude-opus-4-7",
    variant: "max",
    fallback_models: ["openai/gpt-5.6-terra", "openai/gpt-5.5"],
  },
  "moa-aggregator": {
    model: "openai/gpt-5.5",
    reasoningEffort: "xhigh",
    fallback_models: [
      { model: "anthropic/claude-opus-4-7", variant: "max" },
      { model: "google/gemini-3.1-pro", variant: "high" },
    ],
  },
  "moa-aggregator-frontier": {
    model: "anthropic/claude-opus-4-7",
    variant: "max",
    fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-pro"],
  },
  "moa-aggregator-fast": {
    model: "anthropic/claude-sonnet-4-6",
    fallback_models: ["openai/gpt-5.4-mini"],
  },
  "moa-budget-gpt-mini": {
    model: "openai/gpt-5.4-mini",
    fallback_models: ["anthropic/claude-haiku-4-5"],
  },
  "moa-budget-gemini-flash": {
    model: "google/gemini-3-flash",
    fallback_models: ["openai/gpt-5.4-mini"],
  },
  "moa-budget-kimi": {
    model: "opencode-go/kimi-k2.6",
    fallback_models: ["opencode/kimi-k2.5"],
  },
}

const RECURSIVE_MOA_AGENT_NAMES = new Set(["moa", "moa-consult", "moa_consult", "moa-consultation"])

export class MoATargetResolutionError extends Error {
  constructor(readonly target: MoATarget, message: string) {
    super(message)
    this.name = "MoATargetResolutionError"
  }
}

function flattenFallbackChain(chain: readonly FallbackEntry[]): ResolvedMoATarget["fallbackChain"] {
  return chain.flatMap((entry) => entry.providers.map((providerID) => ({
    providerID,
    modelID: entry.model,
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
    ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
  })))
}

function requireExecutorContext(context: ExecutorContext | undefined, target: MoATarget): ExecutorContext {
  if (context === undefined) {
    throw new MoATargetResolutionError(target, "OpenCode target resolution requires an executor context")
  }
  return context
}

function assertNever(value: never): never {
  throw new Error(`Unexpected subagent match: ${String(value)}`)
}

function isCategoryTarget(target: MoATarget): target is Extract<MoATarget, { category: string }> {
  return "category" in target && typeof target.category === "string"
}

function createDefaultCategoryResolver(
  context: ExecutorContext | undefined,
  inheritedModel: string | undefined,
  systemDefaultModel: string | undefined,
): MoATargetResolutionDeps["resolveCategoryExecutionFn"] {
  return async (category) => {
    const target = { category }
    const executorContext = requireExecutorContext(context, target)
    const result = await resolveCategoryExecution({
      description: `Resolve MoA category ${category}`,
      prompt: "MoA consultation target resolution",
      category,
      run_in_background: true,
      load_skills: [],
    }, {
      ...executorContext,
      userCategories: { ...BUILTIN_MOA_CATEGORIES, ...executorContext.userCategories },
    }, inheritedModel, systemDefaultModel)
    if (result.error !== undefined || result.categoryModel === undefined) {
      throw new MoATargetResolutionError(target, result.error ?? `Category "${category}" did not resolve a model`)
    }
    return {
      agent: result.agentToUse,
      category,
      model: result.categoryModel,
      fallbackChain: result.fallbackChain ?? [],
    }
  }
}

function createDefaultSubagentResolver(
  context: ExecutorContext | undefined,
): MoATargetResolutionDeps["resolveSubagentModelFn"] {
  return async (subagentType) => {
    const target = { subagent_type: subagentType }
    const executorContext = requireExecutorContext(context, target)
    const match = await resolveSubagentAgentMatch(subagentType, executorContext, {
      allowPrimaryAgentDelegation: false,
      allowSisyphusJuniorDirect: false,
    })
    switch (match.kind) {
      case "error":
        throw new MoATargetResolutionError(target, match.result.error ?? `Subagent "${subagentType}" is unavailable`)
      case "matched": {
        const result = await resolveSubagentModel(match.agentToUse, match.matchedAgent, executorContext)
        if (result.categoryModel === undefined) {
          throw new MoATargetResolutionError(target, `Subagent "${subagentType}" did not resolve a model`)
        }
        return {
          agent: match.agentToUse,
          agentMode: match.matchedAgent.mode,
          model: result.categoryModel,
          fallbackChain: result.fallbackChain ?? [],
        }
      }
      default:
        return assertNever(match)
    }
  }
}

export function createMoATargetResolver(options: {
  readonly executorContext?: ExecutorContext
  readonly inheritedModel?: string
  readonly systemDefaultModel?: string
  readonly deps?: Partial<MoATargetResolutionDeps>
} = {}): (target: MoATarget) => Promise<ResolvedMoATarget> {
  const resolveCategoryExecutionFn = options.deps?.resolveCategoryExecutionFn
    ?? createDefaultCategoryResolver(options.executorContext, options.inheritedModel, options.systemDefaultModel)
  const resolveSubagentModelFn = options.deps?.resolveSubagentModelFn
    ?? createDefaultSubagentResolver(options.executorContext)

  return async (target) => {
    const source = isCategoryTarget(target)
      ? await resolveCategoryExecutionFn(target.category)
      : await resolveSubagentTarget(target, resolveSubagentModelFn)
    if (source.agentMode === "primary") {
      throw new MoATargetResolutionError(target, `MoA target cannot use primary agent "${source.agent}"`)
    }
    return {
      requested: target,
      agent: source.agent,
      ...(source.category !== undefined ? { category: source.category } : {}),
      model: source.model,
      fallbackChain: flattenFallbackChain(source.fallbackChain),
    }
  }
}

async function resolveSubagentTarget(
  target: Extract<MoATarget, { subagent_type: string }>,
  resolveSubagentModelFn: MoATargetResolutionDeps["resolveSubagentModelFn"],
): Promise<MoATargetResolutionSource> {
  const normalized = target.subagent_type.trim().toLowerCase()
  if (RECURSIVE_MOA_AGENT_NAMES.has(normalized)) {
    throw new MoATargetResolutionError(target, `MoA target cannot launch recursive MoA subagent "${target.subagent_type}"`)
  }
  return resolveSubagentModelFn(target.subagent_type)
}

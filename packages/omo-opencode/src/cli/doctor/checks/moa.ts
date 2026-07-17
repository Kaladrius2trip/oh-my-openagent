import { readFileSync } from "node:fs"
import path from "node:path"
import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import { BUILTIN_PRESETS, validatePreset } from "@oh-my-opencode/moa-core/presets"
import { MoAConfigSchema } from "@oh-my-opencode/moa-core/config"
import type { MoAPresetConfig } from "@oh-my-opencode/moa-core"

import { CategoriesConfigSchema, type CategoriesConfig } from "../../../config/schema/categories"
import { normalizeMoAConfig } from "../../../features/moa/config-normalization"
import { predictFallbackDiversity } from "../../../features/moa/diversity-prediction"
import { buildFallbackChainFromModels } from "../../../shared/fallback-chain-from-models"
import { normalizeFallbackModels } from "../../../shared/model-resolver"
import { parseModelString } from "../../../shared/model-string-parser"
import { detectPluginConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../../shared/plugin-identity"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult } from "../framework/types"

const BUILTIN_MOA_CATEGORIES: CategoriesConfig = {
  "moa-architect": { model: "anthropic/claude-opus-4-7", fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-pro"] },
  "moa-validator": { model: "openai/gpt-5.6-sol", fallback_models: ["anthropic/claude-opus-4-7", "google/gemini-3.1-pro"] },
  "moa-researcher": { model: "openai/gpt-5.6-terra", fallback_models: ["google/gemini-3.1-pro", "anthropic/claude-opus-4-7"] },
  "moa-challenger": { model: "google/gemini-3.1-pro", fallback_models: ["anthropic/claude-opus-4-7", "openai/gpt-5.5"] },
  "moa-skeptic": { model: "openai/gpt-5.6-luna", fallback_models: ["openai/gpt-5.4-mini", "anthropic/claude-sonnet-4-6"] },
  "moa-security-reviewer": { model: "anthropic/claude-opus-4-7", fallback_models: ["openai/gpt-5.6-terra", "openai/gpt-5.5"] },
  "moa-aggregator": { model: "openai/gpt-5.5", fallback_models: ["anthropic/claude-opus-4-7", "google/gemini-3.1-pro"] },
  "moa-aggregator-frontier": { model: "anthropic/claude-opus-4-7", fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-pro"] },
  "moa-aggregator-fast": { model: "anthropic/claude-sonnet-4-6", fallback_models: ["openai/gpt-5.4-mini"] },
  "moa-budget-gpt-mini": { model: "openai/gpt-5.4-mini", fallback_models: ["anthropic/claude-haiku-4-5"] },
  "moa-budget-gemini-flash": { model: "google/gemini-3-flash", fallback_models: ["openai/gpt-5.4-mini"] },
  "moa-budget-kimi": { model: "opencode-go/kimi-k2.6", fallback_models: ["opencode/kimi-k2.5"] },
}

type RawMoAConfig = { readonly moa?: unknown; readonly categories?: unknown }

function loadConfig(): RawMoAConfig {
  const projectConfig = detectPluginConfigFile(path.join(process.cwd(), ".opencode"), {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  const userConfig = detectPluginConfigFile(getOpenCodeConfigDir({ binary: "opencode" }), {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  const configPath = projectConfig.format !== "none" ? projectConfig.path : userConfig.path
  if (configPath === null) return {}
  try {
    return parseJsonc<RawMoAConfig>(readFileSync(configPath, "utf-8"))
  } catch (error) {
    if (error instanceof Error) return {}
    throw error
  }
}

function flattenFallbackChain(category: CategoriesConfig[string], providerID: string): ResolvedMoATarget["fallbackChain"] {
  const chain = buildFallbackChainFromModels(normalizeFallbackModels(category.fallback_models), providerID) ?? []
  return chain.flatMap((entry) => entry.providers.map((candidateProvider) => ({
    providerID: candidateProvider,
    modelID: entry.model,
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
    ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
  })))
}

function resolveAdvisorTargets(preset: MoAPresetConfig, categories: CategoriesConfig): ResolvedMoATarget[] | string {
  const targets: ResolvedMoATarget[] = []
  for (const advisor of preset.advisors) {
    const categoryName = "category" in advisor ? advisor.category : undefined
    if (categoryName === undefined) return `subagent target cannot be checked offline`
    const category = categories[categoryName]
    if (category?.model === undefined) return `category "${categoryName}" has no model`
    const model = parseModelString(category.model)
    if (model === undefined) return `category "${categoryName}" has invalid model "${category.model}"`
    targets.push({
      requested: { category: categoryName },
      agent: "sisyphus-junior",
      category: categoryName,
      model,
      fallbackChain: flattenFallbackChain(category, model.providerID),
    })
  }
  return targets
}

function primaryDiversity(targets: readonly ResolvedMoATarget[]): { readonly providers: number; readonly models: number } {
  return {
    providers: new Set(targets.map((target) => target.model.providerID)).size,
    models: new Set(targets.map((target) => `${target.model.providerID}/${target.model.modelID}`)).size,
  }
}

function sharedProviders(targets: readonly ResolvedMoATarget[]): string[] {
  const providers = targets.map((target) => new Set([target.model, ...target.fallbackChain].map((model) => model.providerID)))
  const first = providers[0]
  if (first === undefined) return []
  return [...first].filter((provider) => providers.every((chain) => chain.has(provider)))
}

function fail(message: string): CheckResult {
  return { name: CHECK_NAMES[CHECK_IDS.MOA], status: "fail", message, issues: [] }
}

export async function checkMoA(): Promise<CheckResult> {
  const raw = loadConfig()
  const parsedMoA = MoAConfigSchema.safeParse(raw.moa ?? {})
  if (!parsedMoA.success) return fail(`moa: invalid configuration: ${parsedMoA.error.issues[0]?.message ?? "unknown error"}`)
  const config = normalizeMoAConfig(parsedMoA.data)
  if (!config.enabled) {
    return { name: CHECK_NAMES[CHECK_IDS.MOA], status: "skip", message: "moa: disabled", issues: [] }
  }

  const presetName = config.default_preset ?? "architecture-balanced"
  const preset = { ...BUILTIN_PRESETS, ...config.presets }[presetName]
  if (preset === undefined) return fail(`moa: default preset "${presetName}" is missing`)
  const errors = validatePreset(preset, { maxAdvisors: config.max_advisors_per_run })
  if (errors.length > 0) return fail(`moa: invalid preset "${presetName}": ${errors.map((error) => error.message).join(" ")}`)

  const parsedCategories = CategoriesConfigSchema.safeParse(raw.categories ?? {})
  if (!parsedCategories.success) return fail(`moa: invalid category configuration: ${parsedCategories.error.issues[0]?.message ?? "unknown error"}`)
  const targets = resolveAdvisorTargets(preset, { ...BUILTIN_MOA_CATEGORIES, ...parsedCategories.data })
  if (typeof targets === "string") return fail(`moa: ${targets}`)

  const primary = primaryDiversity(targets)
  const prediction = predictFallbackDiversity(targets, preset.diversity ?? {})
  const prefix = `moa: enabled | preset: ${presetName} | primary diversity: ${primary.providers} providers, ${primary.models} models`
  if (prediction.outcome === "satisfied") {
    return { name: CHECK_NAMES[CHECK_IDS.MOA], status: "pass", message: `${prefix} | fallback prediction: satisfied`, issues: [] }
  }
  const collisions = sharedProviders(targets)
  const collisionText = collisions.length > 0 ? collisions.join(", ") : "unknown provider"
  return {
    name: CHECK_NAMES[CHECK_IDS.MOA],
    status: "warn",
    message: `${prefix} | fallback prediction: ${prediction.outcome} (${collisionText})`,
    issues: [],
  }
}

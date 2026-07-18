import { readFileSync } from "node:fs"
import path from "node:path"
import { BUILTIN_PRESETS } from "@oh-my-opencode/moa-core/presets"
import { getModelCapabilities } from "../../../shared/model-capabilities"
import { detectPluginConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../../shared/plugin-identity"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { evaluateMoAConfig, type RawMoAConfig } from "./moa-evaluator"
import { BUILTIN_MOA_CATEGORIES } from "./moa-evaluator-defaults"

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

function fail(message: string): CheckResult {
  return { name: CHECK_NAMES[CHECK_IDS.MOA], status: "fail", message, issues: [] }
}

function doctorIssue(issue: ReturnType<typeof evaluateMoAConfig>["warnings"][number]): DoctorIssue {
  return {
    title: issue.title,
    description: issue.message,
    severity: "warning",
    affects: [...issue.affects],
  }
}

function sharedFallbackProviders(result: ReturnType<typeof evaluateMoAConfig>): string[] {
  const providerSets = result.targets.map((target) => new Set(
    [target.model, ...target.fallbackChain].map((model) => model.providerID),
  ))
  const first = providerSets[0]
  if (first === undefined) return []
  return [...first].filter((provider) => providerSets.every((providers) => providers.has(provider)))
}

export async function checkMoA(): Promise<CheckResult> {
  const result = evaluateMoAConfig(loadConfig(), {
    builtinCategories: BUILTIN_MOA_CATEGORIES,
    builtinPresets: BUILTIN_PRESETS,
    supportsTemperature: (model) => {
      const separator = model.indexOf("/")
      if (separator < 1) return undefined
      return getModelCapabilities({
        providerID: model.slice(0, separator),
        modelID: model,
      }).supportsTemperature
    },
  })
  const schemaError = result.errors.find((issue) => issue.code === "schema")
  if (schemaError !== undefined) return fail(`moa: invalid configuration: ${schemaError.message}`)
  if (!result.enabled) {
    return { name: CHECK_NAMES[CHECK_IDS.MOA], status: "skip", message: "moa: disabled", issues: [] }
  }
  const error = result.errors[0]
  if (error !== undefined) return fail(`moa: ${error.message}`)

  const configured = result.configuredDiversity
  const fallback = result.fallbackPrediction
  if (configured === undefined || fallback === undefined) return fail("moa: validation did not resolve diversity")
  const prefix = `moa: enabled | preset: ${result.presetName} | primary diversity: ${configured.counts.providers} providers, ${configured.counts.models} models`
  const issues = result.warnings.map(doctorIssue)
  const collisions = sharedFallbackProviders(result)
  const message = fallback.outcome === "satisfied"
    ? `${prefix} | fallback prediction: satisfied`
    : `${prefix} | fallback prediction: ${fallback.outcome} (${collisions.join(", ") || "unknown provider"})`
  return {
    name: CHECK_NAMES[CHECK_IDS.MOA],
    status: issues.length > 0 ? "warn" : "pass",
    message,
    issues,
  }
}

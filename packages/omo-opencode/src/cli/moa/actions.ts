import { existsSync, readFileSync } from "node:fs"
import { OmoConfigWriteError } from "@oh-my-opencode/omo-config-core"
import { BUILTIN_PRESETS } from "@oh-my-opencode/moa-core/presets"
import { isPlainRecord } from "@oh-my-opencode/utils"
import { validatePluginConfig } from "../../config/validate"
import {
  getModelCapabilities,
  readProviderModelsCache,
  parseJsonc,
} from "../../shared"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import {
  evaluateMoAConfig,
  type MoAEvaluationDependencies,
  type MoAValidationIssue,
  type RawMoAConfig,
} from "../doctor/checks/moa-evaluator"
import { BUILTIN_MOA_CATEGORIES } from "../doctor/checks/moa-evaluator-defaults"
import { buildPresetRows, type MoAPresetRow } from "./preset-list"
import { resolveMoaUserScope } from "./scope"
import { setActiveMoaPreset } from "./use-preset"

type JsonOption = { readonly json?: boolean }
type UseOption = { readonly enable?: boolean }

function modelHints(cache: ProviderModelsCache | null): ReadonlySet<string> | undefined {
  if (cache === null) return undefined
  const models = new Set<string>()
  for (const [provider, entries] of Object.entries(cache.models)) {
    for (const entry of entries) {
      const model = typeof entry === "string" ? entry : entry.id
      models.add(`${provider}/${model}`)
    }
  }
  return models
}

export function createMoaEvaluationDependencies(presetName?: string): MoAEvaluationDependencies {
  return {
    builtinCategories: BUILTIN_MOA_CATEGORIES,
    builtinPresets: BUILTIN_PRESETS,
    knownModels: modelHints(readProviderModelsCache()),
    ...(presetName === undefined ? {} : { presetName }),
    supportsTemperature: (model) => {
      const separator = model.indexOf("/")
      if (separator < 1) return undefined
      return getModelCapabilities({
        providerID: model.slice(0, separator),
        modelID: model,
      }).supportsTemperature
    },
  }
}

function printRows(rows: readonly MoAPresetRow[]): void {
  for (const row of rows) {
    const marker = row.active ? "*" : " "
    const status = row.disabled ? "disabled" : "enabled"
    const description = row.description.length > 0 ? ` | ${row.description}` : ""
    console.log(`${marker} ${row.name} | ${row.provenance} | ${status} | ${row.advisorCount} advisors${description}`)
  }
}

export function runMoaList(options: JsonOption = {}, cwd = process.cwd()): number {
  const validation = validatePluginConfig(cwd)
  if (!validation.valid) {
    for (const message of validation.messages) console.error(`Error: ${message}`)
    return 1
  }
  const rows = buildPresetRows(validation.config.moa)
  if (options.json === true) console.log(JSON.stringify(rows, null, 2))
  else printRows(rows)
  return 0
}

function loadCandidate(configPath: string): RawMoAConfig {
  if (!existsSync(configPath)) return {}
  const raw = parseJsonc<unknown>(readFileSync(configPath, "utf-8"))
  if (!isPlainRecord(raw)) return { moa: raw }
  return { moa: raw.moa, categories: raw.categories }
}

function printWarnings(warnings: readonly MoAValidationIssue[]): void {
  for (const warning of warnings) console.error(`Warning: ${warning.message}`)
}

export function runMoaUse(presetName: string, options: UseOption = {}, cwd = process.cwd()): number {
  const scope = resolveMoaUserScope({ cwd })
  if (scope.kind === "shadowed") {
    console.error(`Refusing user config write: project MoA config at ${scope.path} controls this directory.`)
    return 1
  }
  if (scope.kind === "invalid-project-config") {
    console.error(`Refusing user config write: cannot parse project config at ${scope.path}: ${scope.message}`)
    return 1
  }

  try {
    const result = setActiveMoaPreset({
      presetName,
      enable: options.enable === true,
      candidate: loadCandidate(scope.path),
      configPath: scope.path,
      evaluationDependencies: createMoaEvaluationDependencies(presetName),
    })
    printWarnings(result.evaluation.warnings)
    if (!result.ok) {
      for (const error of result.evaluation.errors) console.error(`Error: ${error.message}`)
      return 1
    }

    console.log(`Active MoA preset set to "${presetName}" in ${result.writeResult.path}.`)
    if (result.evaluation.enabled) console.log("MoA is enabled.")
    else console.log("MoA remains disabled. Pass --enable to enable it explicitly.")
    console.log("Restart OpenCode for /moa, keyword activation, and moa_consult registration changes.")
    return 0
  } catch (error) {
    if (error instanceof OmoConfigWriteError || error instanceof SyntaxError) {
      console.error(`Error: ${error.message}`)
      return 1
    }
    throw error
  }
}

function configIssue(message: string): MoAValidationIssue {
  return {
    code: "config_schema",
    title: "Invalid plugin configuration",
    message,
    affects: [],
  }
}

export function runMoaValidate(presetName: string | undefined, options: JsonOption = {}, cwd = process.cwd()): number {
  const validation = validatePluginConfig(cwd)
  const evaluation = evaluateMoAConfig({
    moa: validation.config.moa,
    categories: validation.config.categories,
  }, createMoaEvaluationDependencies(presetName))
  const errors = [...validation.messages.map(configIssue), ...evaluation.errors]
  const result = {
    valid: errors.length === 0,
    preset: evaluation.presetName,
    enabled: evaluation.enabled,
    errors,
    warnings: evaluation.warnings,
  }
  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.valid) {
    console.log(`MoA preset "${result.preset}" is valid.`)
    printWarnings(result.warnings)
  } else {
    for (const error of result.errors) console.error(`Error: ${error.message}`)
    printWarnings(result.warnings)
  }
  return result.valid ? 0 : 1
}

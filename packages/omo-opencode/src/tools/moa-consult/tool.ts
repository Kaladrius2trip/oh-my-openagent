import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { BUILTIN_PRESETS, DEFAULT_PRESET_NAME, type MoAConfig, type MoAConsultToolResult } from "@oh-my-opencode/moa-core"

import type { MoAManager, MoARunResult } from "../../features/moa"

const MOA_CONSULT_DESCRIPTION = `Consult a Mixture of Advisors (MoA) panel for a decision.
Fans the prompt out to several advisor models plus one aggregator, then returns a synthesized decision bundle.
Advisors are tool-free by default; presets may grant bounded read, grep and glob research. Consultation remains read-only, and the calling parent keeps all implementation authority.`

const MOA_RESEARCH_TOOL_COUNT = 3 as const

function knownPresetNames(config: MoAConfig): readonly string[] {
  return [...new Set([...Object.keys(BUILTIN_PRESETS), ...Object.keys(config.presets ?? {})])]
}

function countByStatus(result: MoARunResult, status: "completed" | "failed" | "timed_out"): number {
  return result.advisorResults.filter((advisorResult) => advisorResult.status === status).length
}

function collectWarnings(result: MoARunResult): string[] {
  return [result.error, result.configuredDiversity?.warning, result.effectiveDiversity?.warning].filter(
    (warning): warning is string => warning !== undefined,
  )
}

function configuredToolCount(config: MoAConfig, preset: string): 0 | 3 {
  const resolvedPreset = config.presets?.[preset] ?? BUILTIN_PRESETS[preset]
  return resolvedPreset?.advisors.some((advisor) => advisor.tool_policy === "read_only") === true
    ? MOA_RESEARCH_TOOL_COUNT
    : 0
}

function toConsultResult(config: MoAConfig, preset: string, result: MoARunResult): MoAConsultToolResult {
  const configured = result.configuredDiversity
  const effective = result.effectiveDiversity ?? configured
  return {
    runId: result.runId,
    preset,
    status: result.status,
    ...(result.synthesis !== undefined ? { synthesis: result.synthesis } : {}),
    execution: {
      policy: "consultation_only",
      toolsExposed: configuredToolCount(config, preset),
      mutationsPerformed: 0,
      implementationAuthority: "parent",
    },
    advisorSummary: {
      requested: result.advisorResults.length,
      successful: countByStatus(result, "completed"),
      failed: countByStatus(result, "failed"),
      timedOut: countByStatus(result, "timed_out"),
    },
    diversity: {
      configuredProviders: configured?.counts.providers ?? 0,
      effectiveProviders: effective?.counts.providers ?? 0,
      configuredModels: configured?.counts.models ?? 0,
      effectiveModels: effective?.counts.models ?? 0,
      outcome: effective?.outcome ?? "satisfied",
    },
    warnings: collectWarnings(result),
  }
}

function summaryOutput(result: MoAConsultToolResult): string {
  if (result.synthesis !== undefined) return result.synthesis
  const detail = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""
  return `MoA consultation ${result.status} (${result.advisorSummary.successful}/${result.advisorSummary.requested} advisors succeeded).${detail}`
}

export function createMoaConsultTool(moaManager: MoAManager, config: MoAConfig): ToolDefinition {
  return tool({
    description: MOA_CONSULT_DESCRIPTION,
    args: {
      prompt: tool.schema.string().describe("The decision or design question to consult the MoA advisor panel about."),
      preset: tool.schema
        .string()
        .describe("Optional MoA preset name. Defaults to the configured default preset.")
        .optional(),
    },
    async execute(args, context) {
      const preset = args.preset ?? config.default_preset ?? DEFAULT_PRESET_NAME
      if (!knownPresetNames(config).includes(preset)) {
        return `Error: unknown MoA preset "${preset}". Available presets: ${[...knownPresetNames(config)].sort().join(", ")}.`
      }
      const runResult = await moaManager.run(
        { prompt: args.prompt, preset },
        { sessionID: context.sessionID, messageID: context.messageID, agent: context.agent },
      )
      const consult = toConsultResult(config, preset, runResult)
      return { title: `MoA consult: ${preset}`, output: summaryOutput(consult), metadata: consult }
    },
  })
}

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  BUILTIN_PRESETS,
  DECISION_BUNDLE_HEADINGS,
  validateDecisionBundle,
  type MoAChildResult,
  type MoAConfig,
  type MoADiversityCheck,
} from "@oh-my-opencode/moa-core"

import type { MoAManager, MoAParentContext, MoARunRequest, MoARunResult } from "../../packages/omo-opencode/src/features/moa"
import { createMoaConsultTool } from "../../packages/omo-opencode/src/tools/moa-consult/tool"

const FixtureSchema = z.object({ id: z.string().min(1), prompt: z.string().min(1) })
const ConsultResultSchema = z.object({
  runId: z.string(),
  preset: z.string(),
  status: z.enum(["completed", "degraded"]),
  synthesis: z.string(),
  execution: z.object({
    policy: z.literal("consultation_only"),
    toolsExposed: z.literal(0),
    mutationsPerformed: z.literal(0),
    implementationAuthority: z.literal("parent"),
  }),
  advisorSummary: z.object({ requested: z.number(), successful: z.number(), failed: z.number(), timedOut: z.number() }),
  diversity: z.object({
    configuredProviders: z.number(),
    effectiveProviders: z.number(),
    configuredModels: z.number(),
    effectiveModels: z.number(),
    outcome: z.enum(["satisfied", "degraded", "failed"]),
  }),
  warnings: z.array(z.string()),
})

type Fixture = z.infer<typeof FixtureSchema>

function decisionBundle(preset: string, fixture: string): string {
  return DECISION_BUNDLE_HEADINGS
    .map((heading) => `${heading}\nSandbox evaluation for ${preset} and ${fixture}.`)
    .join("\n\n")
}

function diversity(outcome: "satisfied" | "degraded", count: number): MoADiversityCheck {
  return {
    counts: { providers: count, models: count },
    meetsProviders: outcome === "satisfied",
    meetsModels: outcome === "satisfied",
    satisfied: outcome === "satisfied",
    policy: "degrade",
    outcome,
    ...(outcome === "degraded" ? { warning: "sandbox fallback collapse" } : {}),
  }
}

function advisors(count: number, degraded: boolean): MoAChildResult[] {
  return Array.from({ length: count }, (_, index) => ({
    handle: { taskId: `advisor-${index + 1}`, role: "advisor" },
    status: degraded && index === count - 1 ? "failed" : "completed",
    finalModel: { providerID: degraded ? "openai" : `provider-${index + 1}`, modelID: `model-${index + 1}` },
    fallbackCount: degraded ? 1 : 0,
  }))
}

function createSandboxManager(fixtures: ReadonlyMap<string, Fixture>): MoAManager {
  return {
    async run(request: MoARunRequest, _context: MoAParentContext): Promise<MoARunResult> {
      const presetName = request.preset ?? "architecture-balanced"
      const preset = BUILTIN_PRESETS[presetName]
      if (preset === undefined) throw new Error(`Unknown sandbox preset: ${presetName}`)
      const fixture = [...fixtures.values()].find((candidate) => candidate.prompt === request.prompt)
      if (fixture === undefined) throw new Error("Unknown sandbox fixture")
      const degraded = fixture.id === "implementation-request"
      const outcome = degraded ? "degraded" : "satisfied"
      return {
        runId: `eval-${presetName}-${fixture.id}`,
        status: degraded ? "degraded" : "completed",
        synthesis: decisionBundle(presetName, fixture.id),
        advisorResults: advisors(preset.advisors.length, degraded),
        configuredDiversity: diversity("satisfied", Math.max(2, preset.advisors.length)),
        effectiveDiversity: diversity(outcome, degraded ? 1 : Math.max(2, preset.advisors.length)),
      }
    },
    async cancel() { return false },
    getRun() { return undefined },
    async shutdown() {},
  }
}

async function loadFixtures(): Promise<Fixture[]> {
  const fixtureDir = path.join(import.meta.dir, "fixtures")
  const files = (await readdir(fixtureDir)).filter((file) => file.endsWith(".json")).toSorted()
  return Promise.all(files.map(async (file) => FixtureSchema.parse(JSON.parse(await readFile(path.join(fixtureDir, file), "utf-8")))))
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4)
}

async function main(): Promise<void> {
  if (!Bun.argv.includes("--sandbox")) {
    console.error("Usage: bun run script/moa-eval/run-eval.ts --sandbox")
    process.exitCode = 1
    return
  }
  const presets = Object.keys(BUILTIN_PRESETS).toSorted()
  const fixtures = await loadFixtures()
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  const config: MoAConfig = { enabled: true, default_preset: "architecture-balanced", max_advisors_per_run: 8 }
  const moaConsult = createMoaConsultTool(createSandboxManager(fixtureMap), config)
  const entries = []
  for (const preset of presets) {
    for (const fixture of fixtures) {
      const startedAt = performance.now()
      const result = await moaConsult.execute({ prompt: fixture.prompt, preset }, {
        sessionID: "eval-session", messageID: `eval-${preset}-${fixture.id}`, agent: "sisyphus",
        directory: process.cwd(), worktree: process.cwd(), abort: new AbortController().signal,
        metadata() {}, async ask() {},
      })
      if (typeof result === "string") throw new Error(result)
      const contract = ConsultResultSchema.parse(result.metadata)
      entries.push({
        preset,
        fixture: fixture.id,
        status: contract.status,
        contractValid: validateDecisionBundle(contract.synthesis).valid,
        latencyMs: Math.max(0, performance.now() - startedAt),
        inputTokensEstimate: tokenEstimate(fixture.prompt),
        outputTokensEstimate: tokenEstimate(contract.synthesis),
        execution: contract.execution,
      })
    }
  }
  console.log(JSON.stringify({ mode: "sandbox", presets, fixtures: fixtures.map((fixture) => fixture.id), entries }, null, 2))
}

await main()

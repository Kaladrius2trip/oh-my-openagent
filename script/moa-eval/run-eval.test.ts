import { describe, expect, test } from "bun:test"
import { z } from "zod"

const repositoryRoot = new URL("../..", import.meta.url).pathname

const EvalReportSchema = z.object({
  mode: z.literal("sandbox"),
  presets: z.array(z.string()),
  fixtures: z.array(z.string()),
  entries: z.array(z.object({
    preset: z.string(),
    fixture: z.string(),
    status: z.enum(["completed", "degraded"]),
    contractValid: z.literal(true),
    latencyMs: z.number().nonnegative(),
    inputTokensEstimate: z.number().int().nonnegative(),
    outputTokensEstimate: z.number().int().nonnegative(),
    execution: z.object({
      policy: z.literal("consultation_only"),
      toolsExposed: z.literal(0),
      mutationsPerformed: z.literal(0),
      implementationAuthority: z.literal("parent"),
    }),
  })),
})

describe("MoA eval harness", () => {
  test("#given sandbox fixtures #when every preset is evaluated #then report has valid contracts and terminal statuses", async () => {
    // when
    const process = Bun.spawn(["bun", "run", "script/moa-eval/run-eval.ts", "--sandbox"], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    // then
    expect(exitCode, stderr).toBe(0)
    const report = EvalReportSchema.parse(JSON.parse(stdout))
    expect(report.presets).toHaveLength(7)
    expect(report.fixtures).toHaveLength(3)
    expect(report.entries).toHaveLength(21)
    expect(new Set(report.entries.map((entry) => entry.status))).toEqual(new Set(["completed", "degraded"]))
  })
})

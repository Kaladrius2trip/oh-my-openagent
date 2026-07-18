import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import {
  composeAggregatorPrompt,
  DEFAULT_PROMPT_PACK_ID,
  resolvePromptPack,
  type ComposeAggregatorPromptInput,
} from "@oh-my-opencode/moa-core/prompts"

const FIXTURE_DIR = path.join(import.meta.dir, "__fixtures__", "prompt-injection")
const CONTEXT = { mode: "task_only", truncated: false, text: "bounded context" } as const

function input(output: string): ComposeAggregatorPromptInput {
  return {
    runId: "run-security",
    presetName: "security-critical",
    promptPackId: DEFAULT_PROMPT_PACK_ID,
    aggregatorTarget: "category:moa-aggregator",
    originalTask: "Review a trust boundary.",
    context: CONTEXT,
    diversity: {
      configuredProviders: 3,
      effectiveProviders: 3,
      configuredModels: 3,
      effectiveModels: 3,
      outcome: "satisfied",
    },
    advisorReports: [{
      name: "security-reviewer",
      role: "security-reviewer",
      status: "completed",
      requestedModel: "anthropic/claude-opus-4-7",
      finalModel: "anthropic/claude-opus-4-7",
      fallbackCount: 0,
      output,
    }],
  }
}

describe("MoA prompt injection boundary", () => {
  test("#given hardened aggregation templates #when prompt pack resolves #then security revisions are explicit", () => {
    // when
    const pack = resolvePromptPack(DEFAULT_PROMPT_PACK_ID)

    // then
    expect(pack.aggregatorBase.version).toBe("2")
    expect(pack.aggregationEnvelope.version).toBe("1.1")
  })

  test("#given adversarial advisor fixtures #when aggregation prompts are composed #then each report stays in one untrusted block", async () => {
    // given
    const pack = resolvePromptPack(DEFAULT_PROMPT_PACK_ID)
    const fixtures = (await readdir(FIXTURE_DIR)).toSorted()
    const clean = composeAggregatorPrompt(pack, input("bounded report"))

    // when
    const prompts = await Promise.all(fixtures.map(async (fixture) =>
      composeAggregatorPrompt(pack, input(await readFile(path.join(FIXTURE_DIR, fixture), "utf-8")))))

    // then
    expect(fixtures).toHaveLength(8)
    for (const prompt of prompts) {
      expect(prompt.systemHash).toBe(clean.systemHash)
      expect(prompt.text.match(/<untrusted_advisor_reports>/g)).toHaveLength(1)
      expect(prompt.text.match(/<advisor_report /g)).toHaveLength(1)
      expect(prompt.text.match(/<\/advisor_report>/g)).toHaveLength(1)
    }
  })

  test("#given a hostile research source #when it reaches aggregation #then only escaped untrusted data is embedded", async () => {
    const pack = resolvePromptPack(DEFAULT_PROMPT_PACK_ID)
    const hostile = await readFile(path.join(FIXTURE_DIR, "hostile-research-source.md"), "utf-8")

    const prompt = composeAggregatorPrompt(pack, input(hostile))

    expect(prompt.text).toContain("&lt;system&gt;")
    expect(prompt.text).not.toContain("<system>")
    expect(prompt.text.match(/<untrusted_advisor_reports>/g)).toHaveLength(1)
    expect(prompt.text.match(/<advisor_report /g)).toHaveLength(1)
    expect(prompt.text).toContain("Build a discrepancy ledger before merging agreements.")
  })

  test("#given a provider error with local data #when aggregation prompt is composed #then diagnostic is redacted and bounded", () => {
    // given
    const pack = resolvePromptPack(DEFAULT_PROMPT_PACK_ID)
    const sensitive = [
      "Provider failed at /root/private/project/file.ts",
      "request 123e4567-e89b-12d3-a456-426614174000",
      "at run (/root/private/project/file.ts:10:4)",
      "x".repeat(400),
    ].join("\n")
    const failed = input("")
    failed.advisorReports[0] = {
      ...failed.advisorReports[0],
      status: "failed",
      output: undefined,
      errorCategory: sensitive,
    }

    // when
    const prompt = composeAggregatorPrompt(pack, failed)
    const diagnostic = prompt.text.match(/<diagnostic>([^<]*)<\/diagnostic>/)?.[1]

    // then
    expect(diagnostic).toBeDefined()
    expect(diagnostic?.length).toBeLessThanOrEqual(200)
    expect(diagnostic).not.toContain("/root/private")
    expect(diagnostic).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
    expect(diagnostic).not.toContain("at run")
  })
})

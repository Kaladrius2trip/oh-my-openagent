import { describe, expect, test } from "bun:test"
import type { MoAConsultToolResult } from "./output-contracts"
import {
  ADVISOR_REPORT_HEADINGS,
  DECISION_BUNDLE_HEADINGS,
  validateAdvisorReport,
  validateDecisionBundle,
} from "./output-contracts"

function reportFrom(headings: readonly string[]): string {
  return headings.map((heading) => `${heading}\n- body\n`).join("\n")
}

describe("advisor report contract", () => {
  test("#given the nine required advisor headings #when listed #then they match the spec order", () => {
    expect(ADVISOR_REPORT_HEADINGS).toEqual([
      "## Executive assessment",
      "## Observed evidence",
      "## Inferences and assumptions",
      "## Recommended approach",
      "## Mode-specific deliverable",
      "## Risks and failure modes",
      "## Verification plan",
      "## Alternatives and dissent",
      "## Confidence",
    ])
  })

  test("#given a complete advisor report #when validated #then it is valid", () => {
    const result = validateAdvisorReport(reportFrom(ADVISOR_REPORT_HEADINGS))

    expect(result).toEqual({ valid: true, missing: [], extra: [] })
  })

  test("#given a report missing the confidence section #when validated #then it fails and reports the missing heading", () => {
    const headings = ADVISOR_REPORT_HEADINGS.filter((heading) => heading !== "## Confidence")

    const result = validateAdvisorReport(reportFrom(headings))

    expect(result.valid).toBe(false)
    expect(result.missing).toContain("## Confidence")
  })

  test("#given a report with an unknown top-level section #when validated #then it fails and reports the extra heading", () => {
    const text = `${reportFrom(ADVISOR_REPORT_HEADINGS)}\n## Unexpected extra\n- body\n`

    const result = validateAdvisorReport(text)

    expect(result.valid).toBe(false)
    expect(result.extra).toContain("## Unexpected extra")
  })
})

describe("decision bundle contract", () => {
  test("#given the twelve required aggregator headings #when listed #then they match the spec order", () => {
    expect(DECISION_BUNDLE_HEADINGS).toEqual([
      "## Decision",
      "## Why this decision",
      "## Proposed technical approach",
      "## Implementation ownership",
      "## Parent action plan",
      "## Risks and mitigations",
      "## Rejected alternatives",
      "## Material disagreements",
      "## Test and acceptance strategy",
      "## Diversity and reliability note",
      "## Remaining uncertainty",
      "## Confidence",
    ])
  })

  test("#given a complete decision bundle #when validated #then it is valid", () => {
    const result = validateDecisionBundle(reportFrom(DECISION_BUNDLE_HEADINGS))

    expect(result).toEqual({ valid: true, missing: [], extra: [] })
  })

  test("#given a bundle missing implementation ownership #when validated #then it fails", () => {
    const headings = DECISION_BUNDLE_HEADINGS.filter((heading) => heading !== "## Implementation ownership")

    const result = validateDecisionBundle(reportFrom(headings))

    expect(result.valid).toBe(false)
    expect(result.missing).toContain("## Implementation ownership")
  })
})

describe("MoAConsultToolResult", () => {
  test("#given a read-only consultation result #when constructed #then execution reports its bounded tool surface", () => {
    const result: MoAConsultToolResult = {
      runId: "run-1",
      preset: "architecture-balanced",
      status: "completed",
      synthesis: "decision bundle text",
      execution: {
        policy: "consultation_only",
        toolsExposed: 3,
        advisorPolicies: [{ name: "researcher", policy: "read_only" }],
        advisorToolsExposed: ["read", "grep", "glob"],
        aggregatorToolsExposed: [],
        mutationsPerformed: 0,
        implementationAuthority: "parent",
      },
      advisorSummary: { requested: 3, successful: 3, failed: 0, timedOut: 0 },
      diversity: {
        configuredProviders: 3,
        effectiveProviders: 3,
        configuredModels: 3,
        effectiveModels: 3,
        outcome: "satisfied",
      },
      warnings: [],
    }

    expect(result.execution.toolsExposed).toBe(3)
    expect(result.execution.advisorToolsExposed).toEqual(["read", "grep", "glob"])
    expect(result.execution.aggregatorToolsExposed).toEqual([])
    expect(result.execution.implementationAuthority).toBe("parent")
  })
})

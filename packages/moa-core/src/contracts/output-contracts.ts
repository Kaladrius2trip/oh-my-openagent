import type { MoARunStatus } from "../types"

export interface MoAContractSection {
  heading: string
  description: string
}

/** Advisor report sections, exact order per spec section 7.8. */
export const ADVISOR_REPORT_SECTIONS: readonly MoAContractSection[] = [
  { heading: "## Executive assessment", description: "One short paragraph with the recommended direction and the most important reason." },
  {
    heading: "## Observed evidence",
    description: "Only facts present in the supplied envelope. Reference file names, symbols, log fragments or constraints when available.",
  },
  {
    heading: "## Inferences and assumptions",
    description: "For each non-observed claim, label it as `Inference` or `Assumption` and state what would verify it.",
  },
  {
    heading: "## Recommended approach",
    description: "Concrete design or next-step sequence for the parent. Do not claim to have executed it.",
  },
  {
    heading: "## Mode-specific deliverable",
    description:
      "Return the artifact required by the active mode: analysis conclusion, research brief, implementation plan, review findings or evidence-search map. Keep it non-executing.",
  },
  {
    heading: "## Risks and failure modes",
    description: "Rank material risks as Critical, High, Medium or Low. Include trigger, consequence and mitigation.",
  },
  {
    heading: "## Verification plan",
    description: "Specific tests, diagnostics, inspections or measurements the parent should perform.",
  },
  {
    heading: "## Alternatives and dissent",
    description:
      "List meaningful alternatives, why they may be better, and why your recommendation still wins. State any strong disagreement with the likely default approach.",
  },
  { heading: "## Confidence", description: "Provide `High`, `Medium` or `Low`, followed by the main unresolved uncertainty." },
]

/** Aggregator decision bundle sections, exact order per spec section 7.11. */
export const DECISION_BUNDLE_SECTIONS: readonly MoAContractSection[] = [
  {
    heading: "## Decision",
    description:
      "A direct recommendation in one to three paragraphs. State whether the parent should proceed, revise, investigate or reject.",
  },
  {
    heading: "## Why this decision",
    description:
      "Evidence-weighted rationale. Separate verified facts from inferences. Explain why the selected approach beats the strongest alternative.",
  },
  {
    heading: "## Proposed technical approach",
    description:
      "Concrete components, ownership, interfaces, state transitions and sequencing. Keep implementation detail proportional to the task and stop before producing implementation artifacts.",
  },
  {
    heading: "## Implementation ownership",
    description:
      "Name the single implementation owner for each write scope. Default to `Parent OMO agent` or one delegated worker. If parallel execution is proposed, prove that ownership is non-overlapping.",
  },
  {
    heading: "## Parent action plan",
    description:
      "Numbered actions divided into: 1. Evidence gathering or unresolved search 2. Implementation by the designated single owner 3. Verification 4. Rollback or recovery preparation.",
  },
  {
    heading: "## Risks and mitigations",
    description: "Rank each material risk. Include trigger, impact, prevention, detection and recovery.",
  },
  {
    heading: "## Rejected alternatives",
    description:
      "List serious alternatives and the evidence or tradeoff that caused rejection. Do not reject an alternative merely because fewer advisors supported it.",
  },
  {
    heading: "## Material disagreements",
    description: "Preserve unresolved advisor conflict and state what observation would resolve it.",
  },
  { heading: "## Test and acceptance strategy", description: "Specific tests, diagnostics and measurable exit criteria." },
  {
    heading: "## Diversity and reliability note",
    description:
      "Summarize advisor success count, effective provider/model diversity, fallback collapse and how those factors affect trust in the result.",
  },
  {
    heading: "## Remaining uncertainty",
    description: "State unresolved assumptions and the minimum additional evidence needed.",
  },
  { heading: "## Confidence", description: "Provide `High`, `Medium` or `Low` with one-sentence justification." },
]

export const ADVISOR_REPORT_HEADINGS: readonly string[] = ADVISOR_REPORT_SECTIONS.map((section) => section.heading)
export const DECISION_BUNDLE_HEADINGS: readonly string[] = DECISION_BUNDLE_SECTIONS.map((section) => section.heading)

export interface ContractValidationResult {
  valid: boolean
  missing: string[]
  extra: string[]
}

function extractTopLevelHeadings(text: string): string[] {
  const headings: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match?.[1] !== undefined) headings.push(`## ${match[1]}`)
  }
  return headings
}

function validateSections(text: string, required: readonly string[]): ContractValidationResult {
  const found = new Set(extractTopLevelHeadings(text))
  const requiredSet = new Set(required)
  const missing = required.filter((heading) => !found.has(heading))
  const extra = [...found].filter((heading) => !requiredSet.has(heading))
  return { valid: missing.length === 0 && extra.length === 0, missing, extra }
}

export function validateAdvisorReport(text: string): ContractValidationResult {
  return validateSections(text, ADVISOR_REPORT_HEADINGS)
}

export function validateDecisionBundle(text: string): ContractValidationResult {
  return validateSections(text, DECISION_BUNDLE_HEADINGS)
}

export interface MoAConsultToolResult {
  runId: string
  preset: string
  status: MoARunStatus
  synthesis?: string
  execution: {
    policy: "consultation_only"
    toolsExposed: 0
    mutationsPerformed: 0
    implementationAuthority: "parent"
  }
  advisorSummary: {
    requested: number
    successful: number
    failed: number
    timedOut: number
  }
  diversity: {
    configuredProviders: number
    effectiveProviders: number
    configuredModels: number
    effectiveModels: number
    outcome: "satisfied" | "degraded" | "failed"
  }
  warnings: string[]
}

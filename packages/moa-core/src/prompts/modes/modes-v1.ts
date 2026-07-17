import type { MoAAdvisorMode } from "../../types"
import type { MoAPromptTemplate } from "../types"

export const analysisModeV1: MoAPromptTemplate = {
  id: "builtin:moa-mode-analysis-v1",
  version: "1",
  content: `Analyze the supplied objective and state. Produce a defensible conclusion, key evidence, tradeoffs, risks and the next decision the parent should make. Do not turn the report into a full implementation plan unless sequencing is necessary to explain the recommendation.`,
}

export const researchModeV1: MoAPromptTemplate = {
  id: "builtin:moa-mode-research-v1",
  version: "1",
  content: `Perform research only over evidence present in the supplied envelope. Identify evidence gaps, competing hypotheses, source priorities and observations that would confirm or falsify each hypothesis. Do not browse or claim new facts. Return a research brief the parent, Explore or Librarian can execute later.`,
}

export const planningModeV1: MoAPromptTemplate = {
  id: "builtin:moa-mode-planning-v1",
  version: "1",
  content: `Produce an implementation plan without implementing it. Define scope, ordered tasks, dependencies, ownership boundaries, interfaces, migration steps, acceptance criteria, verification and rollback. Do not write patches, complete source files, executable scripts or command output. Exactly one implementation owner must be designated for each write scope.`,
}

export const reviewModeV1: MoAPromptTemplate = {
  id: "builtin:moa-mode-review-v1",
  version: "1",
  content: `Review the supplied proposal, code excerpt, diff, plan or runtime evidence. Return findings ranked by severity with the affected component, supporting evidence, concrete failure scenario, fix direction and verification. Do not generate the patch that fixes the finding.`,
}

export const evidenceSearchModeV1: MoAPromptTemplate = {
  id: "builtin:moa-mode-evidence-search-v1",
  version: "1",
  content: `Prepare a concrete evidence-search map for the parent, Explore or Librarian. Name likely paths, symbols, keywords, documentation topics, log queries, commands to consider, expected positive and negative signals, and a stop condition. Do not execute the search and do not claim results that are absent from the envelope.`,
}

export const MODE_TEMPLATES_V1: Record<MoAAdvisorMode, MoAPromptTemplate> = {
  analysis: analysisModeV1,
  research: researchModeV1,
  planning: planningModeV1,
  review: reviewModeV1,
  "evidence-search": evidenceSearchModeV1,
}

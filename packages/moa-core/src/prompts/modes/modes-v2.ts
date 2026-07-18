import type { MoAPromptTemplate } from "../types"

export const researchModeV2: MoAPromptTemplate = {
  id: "builtin:moa-mode-research-v2",
  version: "2",
  content: `Investigate evidence available under the trusted tool policy. Identify evidence gaps, competing hypotheses, source priorities and observations that would confirm or falsify each hypothesis. Do not claim unsupported facts. Return a focused research brief for the parent.`,
}

export const evidenceSearchModeV2: MoAPromptTemplate = {
  id: "builtin:moa-mode-evidence-search-v2",
  version: "2",
  content: `Locate evidence relevant to the assigned question under the trusted tool policy. Name inspected paths, symbols, documentation topics and positive or negative signals. For remaining gaps, provide a concrete search map and stop condition. Do not claim results absent from available evidence.`,
}

export const MODE_TEMPLATES_V2 = [researchModeV2, evidenceSearchModeV2] as const

import { DECISION_BUNDLE_SECTIONS } from "../../contracts"
import type { MoAPromptTemplate } from "../types"

const HEADER = "Return exactly the following Markdown sections."

const sectionText = DECISION_BUNDLE_SECTIONS.map((section) => `${section.heading}\n${section.description}`).join("\n\n")

export const decisionBundleV1: MoAPromptTemplate = {
  id: "builtin:moa-decision-bundle-v1",
  version: "1",
  content: `${HEADER}\n\n${sectionText}`,
}

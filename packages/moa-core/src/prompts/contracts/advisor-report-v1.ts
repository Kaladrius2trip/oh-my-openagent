import { ADVISOR_REPORT_SECTIONS } from "../../contracts"
import type { MoAPromptTemplate } from "../types"

const HEADER = "Return exactly the following Markdown sections. Omit no section. Use bullet points inside sections."

const RESTRICTIONS = `Output restrictions:

- Do not include a patch, unified diff, complete replacement file, executable migration script or commit instructions presented as completed work.
- Small pseudocode or interface sketches are allowed only when they clarify the recommendation, must be labeled \`Illustrative\`, and must not be presented as production-ready implementation.
- Suggested commands may be named only as future parent verification steps. Never fabricate their output.
- Do not claim that files, tests, tools, repositories, URLs or external systems were accessed or changed.`

const sectionText = ADVISOR_REPORT_SECTIONS.map((section) => `${section.heading}\n${section.description}`).join("\n\n")

export const advisorReportV1: MoAPromptTemplate = {
  id: "builtin:moa-advisor-report-v1",
  version: "1",
  content: `${HEADER}\n\n${sectionText}\n\n${RESTRICTIONS}`,
}

import type { MoAToolPolicy } from "../../types"
import type { MoAPromptTemplate } from "../types"

export const TOOL_POLICY_TEMPLATES_V1: Record<MoAToolPolicy, MoAPromptTemplate> = {
  none: {
    id: "builtin:moa-tool-free-guidance-v1",
    version: "1",
    content: `No tools are available to this advisor. Reason only from the supplied envelope. Do not claim any file, repository, URL, command, test or external system was inspected.`,
  },
  read_only: {
    id: "builtin:moa-read-only-guidance-v1",
    version: "1",
    content: `Read-only research tools are available for this advisor. Use them only when the supplied context lacks evidence required for the assigned claim. Prefer targeted searches and reads, stop when the claim is supported or falsified, and never modify state.`,
  },
}

export interface MoAPromptTemplate {
  /** Stable addressable ID, e.g. "builtin:moa-reference-advisor-v1". */
  id: string
  /** Semantic version of the template body. */
  version: string
  /** The rendered-once template text; may contain restricted placeholders. */
  content: string
}

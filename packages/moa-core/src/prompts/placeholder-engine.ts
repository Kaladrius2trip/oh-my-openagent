export class UnknownPlaceholderError extends Error {
  constructor(readonly token: string) {
    super(`Unknown or malformed template placeholder: "${token}"`)
    this.name = "UnknownPlaceholderError"
  }
}

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g
const VALID_TOKEN_PATTERN = /^[A-Z0-9_]+$/

/**
 * Restricted template renderer. Every `{{TOKEN}}` occurrence must be an
 * uppercase snake-case token present in `values`; anything else (lowercase
 * injections, property access, unknown names) throws. Substitution is a single
 * pass over the template, so values are never re-scanned and cannot smuggle
 * further placeholders. No JavaScript evaluation or property access is possible.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, rawToken: string) => {
    const token = rawToken.trim()
    if (!VALID_TOKEN_PATTERN.test(token) || !Object.hasOwn(values, token)) {
      throw new UnknownPlaceholderError(token)
    }
    return values[token] ?? ""
  })
}

/** Escape untrusted text so it cannot close trusted XML-style envelope delimiters. */
export function escapeEnvelopeValue(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

/** List the distinct placeholder tokens a template references, for validation. */
export function extractPlaceholders(template: string): string[] {
  const tokens = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    tokens.add((match[1] ?? "").trim())
  }
  return [...tokens]
}

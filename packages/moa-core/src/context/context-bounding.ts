import type { MoAContextConfig, MoAContextMode } from "../types"

export interface MoAContextToolCall {
  name: string
  args?: string
}

export interface MoAContextMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  /** Hidden state such as chain-of-thought. Always stripped from advisor context. */
  hidden?: boolean
  toolCalls?: MoAContextToolCall[]
  toolResult?: string
}

export interface BuildSanitizedContextInput {
  config: MoAContextConfig
  messages: readonly MoAContextMessage[]
}

export interface SanitizedContext {
  mode: MoAContextMode
  text: string
  truncated: boolean
  includedMessages: number
  omittedMessages: number
}

const DEFAULT_MODE: MoAContextMode = "task_only"
const DEFAULT_PREVIEW_CHARS = 2000
const TASK_ONLY_TEXT = "No prior transcript included."
const CHARS_PER_TOKEN = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function roleLabel(role: "user" | "assistant"): string {
  return role === "user" ? "User" : "Assistant"
}

function previewBounded(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const headLength = Math.floor(maxChars / 2)
  const tailLength = maxChars - headLength
  const omitted = text.length - headLength - tailLength
  const head = text.slice(0, headLength)
  const tail = text.slice(text.length - tailLength)
  return { text: `${head}[... omitted ${omitted} characters ...]${tail}`, truncated: true }
}

function renderMessage(
  message: MoAContextMessage,
  mode: MoAContextMode,
  previewChars: number,
): { text: string; truncated: boolean } {
  const role = message.role === "user" ? "user" : "assistant"
  const lines = [`${roleLabel(role)}: ${message.content}`]
  let truncated = false

  if (mode === "recent_state") {
    for (const call of message.toolCalls ?? []) {
      lines.push(`  tool_call: ${call.name}(${call.args ?? ""})`)
    }
    if (message.toolResult !== undefined) {
      const preview = previewBounded(message.toolResult, previewChars)
      truncated = truncated || preview.truncated
      lines.push(`  tool_result: ${preview.text}`)
    }
  }

  return { text: lines.join("\n"), truncated }
}

function assemble(omittedMessages: number, rendered: readonly string[]): string {
  const header = omittedMessages > 0 ? `[... omitted ${omittedMessages} messages ...]\n\n` : ""
  return `${header}${rendered.join("\n\n")}`
}

function clampTokens(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const budget = maxTokens * CHARS_PER_TOKEN
  if (text.length <= budget) return { text, truncated: false }
  const suffix = " [... truncated ...]"
  const keep = Math.max(0, budget - suffix.length)
  return { text: text.slice(0, keep) + suffix, truncated: true }
}

/**
 * Build a deterministic, bounded, sanitized context view for an advisor or
 * aggregator prompt. Parent system prompt and hidden state are always stripped.
 * Same input yields byte-identical output.
 */
export function buildSanitizedContext(input: BuildSanitizedContextInput): SanitizedContext {
  const mode = input.config.mode ?? DEFAULT_MODE
  const previewChars = input.config.tool_result_preview_chars ?? DEFAULT_PREVIEW_CHARS

  if (mode === "task_only") {
    return { mode, text: TASK_ONLY_TEXT, truncated: false, includedMessages: 0, omittedMessages: 0 }
  }

  const eligible = input.messages.filter(
    (message) => message.hidden !== true && (message.role === "user" || message.role === "assistant"),
  )

  let omittedMessages = 0
  let kept = eligible
  const maxMessages = input.config.max_messages
  if (maxMessages !== undefined && kept.length > maxMessages) {
    omittedMessages += kept.length - maxMessages
    kept = kept.slice(kept.length - maxMessages)
  }

  let contentTruncated = false
  let rendered = kept.map((message) => {
    const result = renderMessage(message, mode, previewChars)
    if (result.truncated) contentTruncated = true
    return result.text
  })

  const maxTokens = input.config.max_tokens
  if (maxTokens !== undefined) {
    while (rendered.length > 1 && estimateTokens(assemble(omittedMessages, rendered)) > maxTokens) {
      rendered = rendered.slice(1)
      omittedMessages += 1
    }
  }

  let text = assemble(omittedMessages, rendered)
  if (maxTokens !== undefined) {
    const clamped = clampTokens(text, maxTokens)
    text = clamped.text
    if (clamped.truncated) contentTruncated = true
  }

  return {
    mode,
    text,
    truncated: omittedMessages > 0 || contentTruncated,
    includedMessages: rendered.length,
    omittedMessages,
  }
}

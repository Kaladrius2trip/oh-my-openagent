import { describe, expect, test } from "bun:test"
import { buildSanitizedContext, type MoAContextMessage } from "./context-bounding"

const PARENT_SYSTEM_SENTINEL = "SECRET_PARENT_SYSTEM_PROMPT_DO_NOT_LEAK"

function conversation(): MoAContextMessage[] {
  return [
    { role: "system", content: PARENT_SYSTEM_SENTINEL },
    { role: "user", content: "first user message" },
    { role: "assistant", content: "first assistant reply" },
    { role: "user", content: "second user message" },
    { role: "assistant", content: "second assistant reply" },
  ]
}

describe("buildSanitizedContext", () => {
  test("#given task_only mode #when built #then no prior transcript is included", () => {
    const result = buildSanitizedContext({ config: { mode: "task_only" }, messages: conversation() })

    expect(result.mode).toBe("task_only")
    expect(result.includedMessages).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.text).not.toContain("first user message")
  })

  test("#given any mode #when built #then the parent system prompt is stripped", () => {
    for (const mode of ["task_only", "recent_text", "recent_state"] as const) {
      const result = buildSanitizedContext({ config: { mode }, messages: conversation() })
      expect(result.text).not.toContain(PARENT_SYSTEM_SENTINEL)
    }
  })

  test("#given hidden messages #when built in recent_text #then hidden content is stripped", () => {
    const messages: MoAContextMessage[] = [
      { role: "assistant", content: "HIDDEN_CHAIN_OF_THOUGHT", hidden: true },
      { role: "user", content: "visible question" },
    ]

    const result = buildSanitizedContext({ config: { mode: "recent_text" }, messages })

    expect(result.text).toContain("visible question")
    expect(result.text).not.toContain("HIDDEN_CHAIN_OF_THOUGHT")
  })

  test("#given recent_text with a message cap #when built #then only the most recent messages remain and an omission marker is present", () => {
    const result = buildSanitizedContext({ config: { mode: "recent_text", max_messages: 2 }, messages: conversation() })

    expect(result.text).toContain("second assistant reply")
    expect(result.text).toContain("second user message")
    expect(result.text).not.toContain("first user message")
    expect(result.omittedMessages).toBe(2)
    expect(result.text).toMatch(/omitted 2 messages/)
    expect(result.truncated).toBe(true)
  })

  test("#given the same input #when built twice #then output is byte-identical", () => {
    const first = buildSanitizedContext({ config: { mode: "recent_state", max_messages: 3 }, messages: conversation() })
    const second = buildSanitizedContext({ config: { mode: "recent_state", max_messages: 3 }, messages: conversation() })

    expect(first.text).toBe(second.text)
  })

  test("#given a token cap #when the transcript exceeds it #then output is bounded and truncation is marked", () => {
    const big = "x".repeat(4000)
    const messages: MoAContextMessage[] = [
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: big },
    ]

    const result = buildSanitizedContext({ config: { mode: "recent_text", max_tokens: 200 }, messages })

    expect(result.truncated).toBe(true)
    expect(Math.ceil(result.text.length / 4)).toBeLessThanOrEqual(200)
    expect(result.text).toMatch(/omitted/)
  })

  test("#given recent_state with a long tool result #when built #then tool activity is rendered and the result is preview-bounded without raw schemas", () => {
    const messages: MoAContextMessage[] = [
      {
        role: "assistant",
        content: "checking the repo",
        toolCalls: [{ name: "grep", args: "pattern=foo" }],
        toolResult: "R".repeat(6000),
      },
    ]

    const result = buildSanitizedContext({
      config: { mode: "recent_state", tool_result_preview_chars: 200 },
      messages,
    })

    expect(result.text).toContain("grep")
    expect(result.text).toMatch(/omitted \d+ characters/)
    expect(result.text).not.toContain("R".repeat(6000))
    expect(result.text).not.toContain("schema")
  })
})

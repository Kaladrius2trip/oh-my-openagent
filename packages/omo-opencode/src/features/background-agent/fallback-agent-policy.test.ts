import { describe, expect, test } from "bun:test"
import { buildFallbackBody } from "./spawner/fallback-agent"
import { buildTaskPromptBody } from "./spawner/task-prompt-body"

describe("background-agent fallback capability policy", () => {
  test("given a tool-free prompt when its agent falls back then the fallback preserves wildcard denial", () => {
    // given
    const original = buildTaskPromptBody({
      kind: "launch",
      agent: "missing-agent",
      model: undefined,
      system: undefined,
      prompt: "Review the proposal",
      includeTeamToolDenylist: true,
      toolPolicy: "none",
      capabilityProfile: "moa-consultation-only",
    })

    // when
    const fallback = buildFallbackBody(original, "general", { includeTeamToolDenylist: true })

    // then
    expect(fallback.tools).toEqual({ "*": false })
  })
})

import { describe, expect, test } from "bun:test"
import { buildTaskPromptBody } from "./spawner/task-prompt-body"

describe("background task capability profiles", () => {
  describe("given the MoA consultation-only profile", () => {
    test("when prompt tools are resolved then no tool survives any permissive input", async () => {
      const promptBody = buildTaskPromptBody({
        kind: "launch",
        agent: "multimodal-looker",
        model: undefined,
        system: undefined,
        prompt: "Review the proposal",
        includeTeamToolDenylist: true,
        capabilityProfile: "moa-consultation-only",
        userPermission: { read: "allow", bash: "allow" },
      })

      expect(promptBody.tools).toEqual({})
      const { createCapabilityProfileResolver } = await import("./capability-profile")
      const resolveTools = createCapabilityProfileResolver(() => ({ forced: true }))
      expect(resolveTools({
        agent: "multimodal-looker",
        includeTeamToolDenylist: true,
        capabilityProfile: "moa-consultation-only",
        userPermission: { forced: "allow" },
      })).toEqual({})
    })
  })

  describe("given toolPolicy none without a named profile", () => {
    test("when tools are resolved then the tool map is empty", () => {
      const promptBody = buildTaskPromptBody({
        kind: "launch",
        agent: "general",
        model: undefined,
        system: undefined,
        prompt: "Review the proposal",
        includeTeamToolDenylist: false,
        toolPolicy: "none",
      })

      expect(promptBody.tools).toEqual({})
    })
  })

  describe("given the default capability profile", () => {
    test("when tools are resolved then the existing exact map is retained", async () => {
      const { createCapabilityProfileResolver } = await import("./capability-profile")
      const resolveTools = createCapabilityProfileResolver(() => ({
        write: false,
        custom_read: true,
      }))

      const tools = resolveTools({
        agent: "general",
        includeTeamToolDenylist: false,
        userPermission: { bash: "deny", read: "allow" },
      })

      expect(tools).toEqual({
        task: false,
        call_omo_agent: true,
        question: false,
        bash: false,
        write: false,
        custom_read: true,
      })
    })
  })
})

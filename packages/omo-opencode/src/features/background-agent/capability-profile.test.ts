import { describe, expect, test } from "bun:test"
import { createCapabilityProfileResolver } from "./capability-profile"
import { buildTaskPromptBody } from "./spawner/task-prompt-body"

const DEFAULT_FORK_TOOLS = ["read", "bash", "edit"] as const

function exposedToolsUnderForkSemantics(tools: Readonly<Record<string, boolean>>): readonly string[] {
  const rules = Object.entries(tools)
  return DEFAULT_FORK_TOOLS.filter((tool) => {
    const rule = rules.findLast(([permission]) => permission === tool || permission === "*")
    return rule?.[1] !== false
  })
}

describe("background task capability profiles", () => {
  describe("given the MoA consultation-only profile", () => {
    test("when prompt tools are resolved then a wildcard deny removes the fork default registry", () => {
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

      expect(promptBody.tools).toEqual({ "*": false })
      expect(exposedToolsUnderForkSemantics(promptBody.tools)).toEqual([])
    })

    test("when permissive restrictions are injected then no capability can be added", () => {
      const resolveTools = createCapabilityProfileResolver(() => ({ forced: true }))
      const tools = resolveTools({
        agent: "multimodal-looker",
        includeTeamToolDenylist: true,
        capabilityProfile: "moa-consultation-only",
        userPermission: { forced: "allow" },
      })

      expect(tools).toEqual({ "*": false })
    })
  })

  describe("given toolPolicy none without a named profile", () => {
    test("when tools are resolved then the wildcard denies the fork default registry", () => {
      const promptBody = buildTaskPromptBody({
        kind: "launch",
        agent: "general",
        model: undefined,
        system: undefined,
        prompt: "Review the proposal",
        includeTeamToolDenylist: false,
        toolPolicy: "none",
      })

      expect(promptBody.tools).toEqual({ "*": false })
      expect(exposedToolsUnderForkSemantics(promptBody.tools)).toEqual([])
    })
  })

  describe("given an invalid capability profile", () => {
    test("when tools are resolved then launch fails closed", () => {
      const input = {
        agent: "general",
        includeTeamToolDenylist: false,
      }
      Reflect.set(input, "capabilityProfile", "unknown-profile")

      expect(() => createCapabilityProfileResolver()(input)).toThrow(/Unknown capability profile/)
    })
  })

  describe("given an explicitly conflicting tool policy and capability profile", () => {
    test("when tools are resolved then launch fails closed", () => {
      expect(() => createCapabilityProfileResolver()({
        agent: "general",
        includeTeamToolDenylist: false,
        toolPolicy: "default",
        capabilityProfile: "moa-consultation-only",
      })).toThrow(/Conflicting capability profile/)
    })
  })

  describe("given the default capability profile", () => {
    test("when tools are resolved then the existing exact map is retained", () => {
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

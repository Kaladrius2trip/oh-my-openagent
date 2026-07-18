import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { MoAConfig, MoATarget } from "@oh-my-opencode/moa-core"
import type { ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createMoaConsultTool } from "../../tools/moa-consult/tool"
import { BackgroundManager } from "../background-agent"
import { createMoAExecutionAdapter } from "./moa-execution-adapter"
import { createMoAManager } from "./moa-manager"

type PromptCall = {
  readonly path: { readonly id: string }
  readonly body: { readonly parts?: readonly { readonly type?: string; readonly text?: string }[] }
}

const advisorOutputs = [
  "ADVISOR_OUTPUT_ARCHITECT",
  "ADVISOR_OUTPUT_VALIDATOR",
  "ADVISOR_OUTPUT_CHALLENGER",
] as const
const synthesis = "SYNTHESIS_FROM_AGGREGATOR"

const config: MoAConfig = {
  enabled: true,
  default_preset: "output-transport",
  max_advisors_per_run: 8,
  presets: {
    "output-transport": {
      execution_policy: "consultation_only",
      advisors: [
        { name: "architect", category: "advisor-a", tool_policy: "none" },
        { name: "validator", category: "advisor-b", tool_policy: "none" },
        { name: "challenger", category: "advisor-c", tool_policy: "none" },
      ],
      aggregator: { category: "aggregator" },
      diversity: {
        min_distinct_providers: 2,
        min_distinct_models: 2,
        on_configured_violation: "fail",
        on_effective_violation: "fail",
      },
      min_successful_advisors: 3,
      advisor_timeout_ms: 1_000,
      aggregator_timeout_ms: 1_000,
    },
  },
}

function resolveTarget(target: MoATarget): Promise<ResolvedMoATarget> {
  const category = "category" in target ? target.category : target.subagent_type
  if (category === undefined) throw new Error("MoA target category missing")
  const models: Readonly<Record<string, { readonly providerID: string; readonly modelID: string }>> = {
    "advisor-a": { providerID: "openai", modelID: "advisor-a-model" },
    "advisor-b": { providerID: "openrouter", modelID: "advisor-b-model" },
    "advisor-c": { providerID: "anthropic", modelID: "advisor-c-model" },
    aggregator: { providerID: "openai", modelID: "aggregator-model" },
  }
  const model = models[category]
  if (model === undefined) throw new Error(`Missing target model for ${category}`)
  return Promise.resolve({ requested: target, agent: "sisyphus-junior", category, model, fallbackChain: [] })
}

describe("MoA output transport", () => {
  test("#given real background orchestration #when moa_consult runs #then advisor text reaches aggregator and synthesis returns without parent dispatch", async () => {
    // given
    const promptCalls: PromptCall[] = []
    const outputBySession = new Map<string, string>()
    const dispatchedSessions = new Set<string>()
    let sessionCount = 0
    let manager: BackgroundManager | undefined
    const client = {
      session: {
        get: async ({ path }: { path: { id: string } }) => ({
          data: { id: path.id, directory: "/tmp/moa-output-e2e" },
        }),
        create: async () => {
          sessionCount += 1
          const sessionID = `child-session-${sessionCount}`
          outputBySession.set(
            sessionID,
            sessionCount <= advisorOutputs.length ? advisorOutputs[sessionCount - 1] ?? "" : synthesis,
          )
          return { data: { id: sessionID } }
        },
        promptAsync: async (call: PromptCall) => {
          promptCalls.push(call)
          dispatchedSessions.add(call.path.id)
          const task = manager?.findBySession(call.path.id)
          if (task !== undefined) {
            task.startedAt = new Date(Date.now() - 10_000)
            manager?.handleEvent({ type: "session.idle", properties: { sessionID: call.path.id } })
          }
          return { data: {} }
        },
        messages: async ({ path }: { path: { id: string } }) => ({
          data: dispatchedSessions.has(path.id)
            ? [{
                info: { role: "assistant" },
                parts: [{ type: "text", text: outputBySession.get(path.id) ?? "" }],
              }]
            : [],
        }),
        todo: async () => ({ data: [] }),
        abort: async () => ({ data: true }),
      },
    }
    manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client, directory: "/tmp/moa-output-e2e" }),
    })
    const moaManager = createMoAManager({
      config,
      createRunId: () => "run-output-e2e",
      createAdapter: (parent) => createMoAExecutionAdapter({
        backgroundManager: manager ?? (() => { throw new Error("Background manager missing") })(),
        parent,
        resolveTarget,
        pollIntervalMs: 1,
      }),
    })
    const moaConsult = createMoaConsultTool(moaManager, config)

    try {
      // when
      const result = await moaConsult.execute({ prompt: "Choose transport" }, {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        directory: "/tmp/moa-output-e2e",
        worktree: "/tmp/moa-output-e2e",
        abort: new AbortController().signal,
        metadata() {},
        async ask() {},
      })

      // then
      if (typeof result === "string") throw new Error(`Expected structured MoA result, got ${result}`)
      expect(result.output).toBe(synthesis)
      expect(result.metadata?.synthesis).toBe(synthesis)
      const aggregatorCall = promptCalls.find((call) => call.path.id === "child-session-4")
      const aggregatorPrompt = aggregatorCall?.body.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n") ?? ""
      for (const advisorOutput of advisorOutputs) {
        expect(aggregatorPrompt).toContain(advisorOutput)
      }
      expect(promptCalls.filter((call) => call.path.id === "parent-session")).toEqual([])
    } finally {
      await moaManager.shutdown()
      await manager.shutdown()
    }
  })
})

import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { OpencodeClient, QueueItem } from "./constants"
import { ConcurrencyManager } from "./concurrency"
import {
  tryFallbackRetry,
  type FallbackRetryHandlerDeps,
} from "./fallback-retry-handler"
import type { BackgroundTask } from "./types"

const fallbackChain: FallbackEntry[] = [
  {
    model: "fallback-model",
    providers: ["provider-b"],
    variant: "high",
    reasoningEffort: "medium",
    temperature: 0.7,
    top_p: 0.9,
    maxTokens: 4096,
    thinking: { type: "enabled", budgetTokens: 2048 },
  },
]

function createBackgroundTask(): BackgroundTask {
  return {
    id: "bg-retry-policy",
    description: "Consult advisors",
    prompt: "Review the proposal",
    agent: "oracle",
    status: "error",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    model: { providerID: "provider-a", modelID: "primary-model" },
    fallbackChain,
    attemptCount: 0,
    suppressTmuxSpawn: true,
    skills: ["programming", "systematic-debugging"],
    userPermission: { read: "allow", bash: "deny" },
    visibility: "internal",
    notificationPolicy: "manual",
    continuationPolicy: "forbid",
    toolPolicy: "none",
    capabilityProfile: "moa-consultation-only",
    researchToolWhitelist: ["read", "list"],
    directory: "/target/project",
    maxToolCalls: 12,
    orchestration: {
      kind: "moa",
      runId: "run-retry",
      role: "advisor",
      slot: "correctness",
    },
  }
}

function createRetryDependencies(): Partial<FallbackRetryHandlerDeps> {
  return {
    log: mock(() => {}),
    readConnectedProvidersCache: mock(() => null),
    readProviderModelsCache: mock((): ProviderModelsCache | null => null),
    shouldRetryError: mock(() => true),
    getNextFallback: mock((chain: FallbackEntry[], attempt: number) => chain[attempt]),
    hasMoreFallbacks: mock((chain: FallbackEntry[], attempt: number) => attempt < chain.length),
    selectFallbackProvider: mock((providers: string[]) => providers[0]),
    transformModelForProvider: mock((_provider: string, model: string) => model),
  }
}

describe("fallback retry launch input", () => {
  describe("given a persisted task with legacy and policy controls", () => {
    test("when fallback retry requeues then every launch control is preserved", async () => {
      const task = createBackgroundTask()
      const queuesByKey = new Map<string, QueueItem[]>()
      const client = unsafeTestValue<OpencodeClient>({
        session: { abort: mock(async () => ({ data: true })) },
      })

      const retried = await tryFallbackRetry({
        task,
        errorInfo: { name: "OverloadedError", message: "model overloaded" },
        source: "test",
        concurrencyManager: new ConcurrencyManager(),
        client,
        idleDeferralTimers: new Map(),
        queuesByKey,
        processKey: mock(() => {}),
        deps: createRetryDependencies(),
      })
      const retryInput = Array.from(queuesByKey.values()).flat().at(0)?.input

      expect(retried).toBe(true)
      expect(retryInput).toMatchObject({
        suppressTmuxSpawn: true,
        skills: ["programming", "systematic-debugging"],
        userPermission: { read: "allow", bash: "deny" },
        visibility: "internal",
        notificationPolicy: "manual",
        continuationPolicy: "forbid",
        toolPolicy: "none",
        capabilityProfile: "moa-consultation-only",
        researchToolWhitelist: ["read", "list"],
        directory: "/target/project",
        maxToolCalls: 12,
        orchestration: {
          kind: "moa",
          runId: "run-retry",
          role: "advisor",
          slot: "correctness",
        },
      })
      expect({
        directory: retryInput?.directory,
        researchToolWhitelist: retryInput?.researchToolWhitelist,
      }).toEqual({
        directory: task.directory,
        researchToolWhitelist: task.researchToolWhitelist,
      })
    })

    test("when fallback retry requeues then every fallback model setting is preserved", async () => {
      const task = createBackgroundTask()
      const queuesByKey = new Map<string, QueueItem[]>()
      const client = unsafeTestValue<OpencodeClient>({
        session: { abort: mock(async () => ({ data: true })) },
      })

      await tryFallbackRetry({
        task,
        errorInfo: { name: "OverloadedError", message: "model overloaded" },
        source: "test",
        concurrencyManager: new ConcurrencyManager(),
        client,
        idleDeferralTimers: new Map(),
        queuesByKey,
        processKey: mock(() => {}),
        deps: createRetryDependencies(),
      })
      const retryModel = Array.from(queuesByKey.values()).flat().at(0)?.input.model

      expect(retryModel).toEqual({
        providerID: "provider-b",
        modelID: "fallback-model",
        variant: "high",
        reasoningEffort: "medium",
        temperature: 0.7,
        top_p: 0.9,
        maxTokens: 4096,
        thinking: { type: "enabled", budgetTokens: 2048 },
      })
    })
  })
})

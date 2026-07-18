/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import type { MoAChildLaunchInput, ResolvedMoATarget } from "@oh-my-opencode/moa-core/adapter"

import { createMoAExecutionAdapter } from "./moa-execution-adapter"

const target: ResolvedMoATarget = {
  requested: { category: "moa-architect" },
  agent: "sisyphus-junior",
  category: "moa-architect",
  model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
  fallbackChain: [],
}

const input: MoAChildLaunchInput = {
  role: "advisor",
  target,
  prompt: "advisor prompt",
  visibility: "internal",
  notificationPolicy: "manual",
  suppressTmuxSpawn: true,
  toolPolicy: "none",
  capabilityProfile: "moa-consultation-only",
  continuationPolicy: "forbid",
  orchestration: { kind: "moa", runId: "run-1", role: "advisor", slot: "architect" },
}

test("#given observer readiness is pending #when the pre-prompt session callback runs #then it returns without waiting for the observer", async () => {
  let releaseOpen = (): void => {}
  let markOpenStarted = (): void => {}
  const openStarted = new Promise<void>((resolve) => { markOpenStarted = resolve })
  const pendingOpen = new Promise<void>((resolve) => { releaseOpen = resolve })
  let callbackReturned = false
  const adapter = createMoAExecutionAdapter({
    backgroundManager: {
      launch: async (launchInput) => {
        await launchInput.onSessionCreated?.("session-1")
        callbackReturned = true
        return { id: "bg-1", sessionId: "session-1" }
      },
      getTask: () => ({ id: "bg-1", status: "running", model: target.model }),
      readTaskOutput: async () => ({ status: "failed", reason: "task_missing" }),
      cancelTask: async () => true,
    },
    parent: { sessionID: "parent-session", messageID: "parent-message" },
    resolveTarget: async () => target,
    sessionObserver: {
      openSession: async () => {
        markOpenStarted()
        await pendingOpen
      },
      closeSession: async () => {},
    },
  })

  const launch = adapter.launchChild(input)
  await openStarted
  await Promise.resolve()

  try {
    expect(callbackReturned).toBe(true)
  } finally {
    releaseOpen()
    await launch
  }
})

import { describe, expect, mock, test } from "bun:test"

import type { WindowState, WindowStateQueryResult } from "./types"
import { createSourcePaneRecovery } from "./source-pane-recovery"

function createState(input: {
  readonly windowId?: string
  readonly activePaneId: string
  readonly otherPaneIds?: readonly string[]
  readonly attached?: boolean
}): WindowState {
  const panes = [input.activePaneId, ...(input.otherPaneIds ?? [])]
  return {
    windowId: input.windowId,
    windowWidth: 200,
    windowHeight: 40,
    windowActive: true,
    sessionAttached: input.attached ?? true,
    mainPane: {
      paneId: panes[0] ?? input.activePaneId,
      width: 100,
      height: 40,
      left: 0,
      top: 0,
      title: "main",
      isActive: (panes[0] ?? input.activePaneId) === input.activePaneId,
    },
    agentPanes: panes.slice(1).map((paneId, index) => ({
      paneId,
      width: 50,
      height: 40,
      left: 100 + index * 50,
      top: 0,
      title: "pane",
      isActive: paneId === input.activePaneId,
    })),
  }
}

describe("createSourcePaneRecovery", () => {
  test("#given original source %1 and active non-managed %5 #when %1 disappears #then source resolves once to %5 and stays cached", async () => {
    // given
    const results: WindowStateQueryResult[] = [
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%1" }) },
      { kind: "source_gone" },
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%5", otherPaneIds: ["%9"] }) },
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%5", otherPaneIds: ["%9"] }) },
    ]
    const queriedTargets: string[] = []
    const queryWindowState = mock(async (target: string) => {
      queriedTargets.push(target)
      const result = results.shift()
      if (!result) throw new Error("Missing query result")
      return result
    })
    const recovery = createSourcePaneRecovery({
      initialPaneId: "%1",
      queryWindowState,
      getManagedPaneIds: () => new Set(["%9"]),
      log: () => undefined,
    })

    // when
    await recovery.queryWindowState()
    const recovered = await recovery.queryWindowState()
    const cached = await recovery.queryWindowState()

    // then
    expect(recovered.kind).toBe("ok")
    expect(cached.kind).toBe("ok")
    expect(recovery.getPaneId()).toBe("%5")
    expect(queriedTargets).toEqual(["%1", "%1", "@7", "%5"])
  })

  test("#given original window disappears #when stale source resolves #then batch stays unavailable with one diagnostic", async () => {
    // given
    const results: WindowStateQueryResult[] = [
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%1" }) },
      { kind: "source_gone" },
      { kind: "source_gone" },
    ]
    const log = mock(() => undefined)
    const recovery = createSourcePaneRecovery({
      initialPaneId: "%1",
      queryWindowState: async () => results.shift() ?? { kind: "source_gone" },
      getManagedPaneIds: () => new Set<string>(),
      log,
    })
    await recovery.queryWindowState()

    // when
    const result = await recovery.queryWindowState()

    // then
    expect(result).toEqual({ kind: "source_gone" })
    expect(recovery.getPaneId()).toBe("%1")
    expect(log).toHaveBeenCalledTimes(1)
  })

  test("#given only active candidate is manager-owned #when stale source resolves #then managed pane is excluded", async () => {
    // given
    const results: WindowStateQueryResult[] = [
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%1" }) },
      { kind: "source_gone" },
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%5", otherPaneIds: ["%6"] }) },
    ]
    const log = mock(() => undefined)
    const recovery = createSourcePaneRecovery({
      initialPaneId: "%1",
      queryWindowState: async () => results.shift() ?? { kind: "source_gone" },
      getManagedPaneIds: () => new Set(["%5"]),
      log,
    })
    await recovery.queryWindowState()

    // when
    const result = await recovery.queryWindowState()

    // then
    expect(result).toEqual({ kind: "source_gone" })
    expect(recovery.getPaneId()).toBe("%1")
    expect(log).toHaveBeenCalledTimes(1)
  })

  test("#given source disappears before original window is known #when queried #then it does not search globally", async () => {
    // given
    const queriedTargets: string[] = []
    const recovery = createSourcePaneRecovery({
      initialPaneId: "%1",
      queryWindowState: async (target) => {
        queriedTargets.push(target)
        return { kind: "source_gone" }
      },
      getManagedPaneIds: () => new Set<string>(),
      log: () => undefined,
    })

    // when
    const result = await recovery.queryWindowState()

    // then
    expect(result).toEqual({ kind: "source_gone" })
    expect(queriedTargets).toEqual(["%1"])
  })

  test("#given split-window reports target loss after a healthy query #when forced recovery runs #then original window selects replacement", async () => {
    // given
    const results: WindowStateQueryResult[] = [
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%1" }) },
      { kind: "ok", state: createState({ windowId: "@7", activePaneId: "%5" }) },
    ]
    const recovery = createSourcePaneRecovery({
      initialPaneId: "%1",
      queryWindowState: async () => results.shift() ?? { kind: "source_gone" },
      getManagedPaneIds: () => new Set<string>(),
      log: () => undefined,
    })
    await recovery.queryWindowState()

    // when
    const result = await recovery.recoverAfterTargetLoss()

    // then
    expect(result.kind).toBe("ok")
    expect(recovery.getPaneId()).toBe("%5")
  })
})

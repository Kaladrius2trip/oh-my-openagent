import type { MoAResolvedModel, MoATarget, MoAToolPolicy } from "../types"

export interface ResolvedFallbackTarget {
  providerID: string
  modelID: string
  variant?: string
  reasoningEffort?: string
}

export interface ResolvedMoATarget {
  requested: MoATarget
  agent: string
  category?: string
  model: MoAResolvedModel
  fallbackChain: readonly ResolvedFallbackTarget[]
}

export type MoAChildRole = "advisor" | "aggregator"

export interface MoAOrchestrationTag {
  kind: "moa"
  runId: string
  role: MoAChildRole
  slot?: string
}

/**
 * Launch input for a MoA consultation child. The security controls are pinned as
 * literal types so an adapter implementation cannot launch an advisor or
 * aggregator without internal visibility, manual notification, suppressed tmux,
 * a zero-tool policy, the consultation-only capability profile and forbidden
 * continuation.
 */
export interface MoAChildLaunchInput {
  role: MoAChildRole
  target: ResolvedMoATarget
  prompt: string
  visibility: "internal"
  notificationPolicy: "manual"
  suppressTmuxSpawn: true
  toolPolicy: MoAToolPolicy
  capabilityProfile: "moa-consultation-only"
  continuationPolicy: "forbid"
  orchestration: MoAOrchestrationTag
  maxTokens?: number
}

export interface MoAChildHandle {
  taskId: string
  sessionId?: string
  role: MoAChildRole
  slot?: string
}

export type MoAChildStatus = "completed" | "failed" | "timed_out" | "cancelled"

export interface MoAChildResult {
  handle: MoAChildHandle
  status: MoAChildStatus
  output?: string
  finalModel: MoAResolvedModel
  fallbackCount: number
  errorCategory?: string
  truncated?: boolean
}

/** The injected boundary between harness-neutral MoA orchestration and a concrete
 * background execution engine. Implemented by the OpenCode adapter in PR3. */
export interface MoAExecutionAdapter {
  resolveTarget(target: MoATarget): Promise<ResolvedMoATarget>
  launchChild(input: MoAChildLaunchInput): Promise<MoAChildHandle>
  waitForChild(handle: MoAChildHandle, timeoutMs: number, signal: AbortSignal): Promise<MoAChildResult>
  cancelChild(handle: MoAChildHandle, reason: string): Promise<void>
}

/** The exact control values every MoA consultation child must carry. */
export const MOA_CONSULTATION_LAUNCH_CONTROLS = {
  visibility: "internal",
  notificationPolicy: "manual",
  suppressTmuxSpawn: true,
  toolPolicy: "none",
  capabilityProfile: "moa-consultation-only",
  continuationPolicy: "forbid",
} as const

const CONSULTATION_CONTROL_KEYS = [
  "visibility",
  "notificationPolicy",
  "suppressTmuxSpawn",
  "toolPolicy",
  "capabilityProfile",
  "continuationPolicy",
] as const

/** Runtime defense in depth: reject any launch input that drops a required control. */
export function assertConsultationOnlyLaunch(input: MoAChildLaunchInput): void {
  for (const key of CONSULTATION_CONTROL_KEYS) {
    const expected = MOA_CONSULTATION_LAUNCH_CONTROLS[key]
    if (input[key] !== expected) {
      throw new Error(
        `MoA consultation launch control "${key}" must be ${String(expected)}, found ${String(input[key])}.`,
      )
    }
  }
  if (input.orchestration.kind !== "moa") {
    throw new Error('MoA consultation launch must carry an orchestration tag with kind "moa".')
  }
}

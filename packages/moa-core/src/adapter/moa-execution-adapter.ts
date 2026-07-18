import type { MoAResolvedModel, MoATarget, MoAToolPolicy } from "../types"

export type ResolvedFallbackTarget = MoAResolvedModel

export interface ResolvedMoATarget {
  requested: MoATarget
  agent: string
  category?: string
  model: MoAResolvedModel
  fallbackChain: readonly ResolvedFallbackTarget[]
}

export type MoAChildRole = "advisor" | "aggregator"

export type MoAOrchestrationTag =
  | {
      readonly kind: "moa"
      readonly runId: string
      readonly role: "advisor"
      readonly slot?: string
    }
  | {
      readonly kind: "moa"
      readonly runId: string
      readonly role: "aggregator"
      readonly slot?: never
    }

/**
 * Launch input for a MoA consultation child. The security controls are pinned as
 * literal types so an adapter implementation cannot launch an advisor or
 * aggregator without internal visibility, manual notification, suppressed tmux,
 * a zero-tool policy, the consultation-only capability profile and forbidden
 * continuation.
 */
type MoAChildLaunchBase = {
  readonly target: ResolvedMoATarget
  readonly prompt: string
  readonly visibility: "internal"
  readonly notificationPolicy: "manual"
  readonly suppressTmuxSpawn: true
  readonly continuationPolicy: "forbid"
  readonly temperature?: number
  readonly maxTokens?: number
}

type MoAAdvisorToolControls =
  | {
      readonly toolPolicy: Extract<MoAToolPolicy, "none">
      readonly capabilityProfile: "moa-consultation-only"
    }
  | {
      readonly toolPolicy: Extract<MoAToolPolicy, "read_only">
      readonly capabilityProfile: "moa-research"
    }

export type MoAAdvisorChildLaunchInput = MoAChildLaunchBase &
  MoAAdvisorToolControls & {
    readonly role: "advisor"
    readonly orchestration: Extract<MoAOrchestrationTag, { readonly role: "advisor" }>
  }

export type MoAAggregatorChildLaunchInput = MoAChildLaunchBase & {
  readonly role: "aggregator"
  readonly toolPolicy: "none"
  readonly capabilityProfile: "moa-consultation-only"
  readonly orchestration: Extract<MoAOrchestrationTag, { readonly role: "aggregator" }>
}

export type MoAChildLaunchInput = MoAAdvisorChildLaunchInput | MoAAggregatorChildLaunchInput

type MoAChildLaunchCandidate = {
  readonly role: string
  readonly target: ResolvedMoATarget
  readonly prompt: string
  readonly visibility: string
  readonly notificationPolicy: string
  readonly suppressTmuxSpawn: boolean
  readonly toolPolicy: string
  readonly capabilityProfile: string
  readonly continuationPolicy: string
  readonly orchestration: {
    readonly kind: string
    readonly runId: string
    readonly role: string
    readonly slot?: string
  }
  readonly temperature?: number
  readonly maxTokens?: number
}

export class MoALaunchContractError extends Error {
  readonly name = "MoALaunchContractError"

  constructor(
    readonly code: "control_mismatch" | "invalid_orchestration" | "role_mismatch" | "unknown_profile" | "invalid_tool_pair" | "unknown_role",
    message: string,
  ) {
    super(message)
  }
}

export interface MoAChildHandle {
  taskId: string
  sessionId?: string
  role: MoAChildRole
  slot?: string
}

export interface MoAChildWaitTimeouts {
  readonly baseMs: number
  readonly idleWindowMs: number
  readonly maxWallMs: number
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
  waitForChild(handle: MoAChildHandle, timeouts: MoAChildWaitTimeouts, signal: AbortSignal): Promise<MoAChildResult>
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

export const MOA_RESEARCH_LAUNCH_CONTROLS = {
  visibility: "internal",
  notificationPolicy: "manual",
  suppressTmuxSpawn: true,
  toolPolicy: "read_only",
  capabilityProfile: "moa-research",
  continuationPolicy: "forbid",
} as const

const CONSULTATION_CONTROL_KEYS = [
  "visibility",
  "notificationPolicy",
  "suppressTmuxSpawn",
  "continuationPolicy",
] as const

/** Runtime defense in depth: reject any launch input that drops a required control. */
export function assertConsultationOnlyLaunch(input: MoAChildLaunchCandidate): void {
  for (const key of CONSULTATION_CONTROL_KEYS) {
    const expected = MOA_CONSULTATION_LAUNCH_CONTROLS[key]
    if (input[key] !== expected) {
      throw new MoALaunchContractError(
        "control_mismatch",
        `MoA consultation launch control "${key}" must be ${String(expected)}, found ${String(input[key])}.`,
      )
    }
  }
  if (input.orchestration.kind !== "moa") {
    throw new MoALaunchContractError(
      "invalid_orchestration",
      'MoA consultation launch must carry an orchestration tag with kind "moa".',
    )
  }
  if (input.role !== input.orchestration.role) {
    throw new MoALaunchContractError("role_mismatch", "MoA child role must match orchestration role.")
  }
  if (
    input.capabilityProfile !== "moa-consultation-only"
    && input.capabilityProfile !== "moa-research"
  ) {
    throw new MoALaunchContractError(
      "unknown_profile",
      `Unknown capability profile: ${String(input.capabilityProfile)}`,
    )
  }

  switch (input.role) {
    case "advisor":
      if (
        (input.toolPolicy === "none" && input.capabilityProfile === "moa-consultation-only")
        || (input.toolPolicy === "read_only" && input.capabilityProfile === "moa-research")
      ) {
        return
      }
      throw new MoALaunchContractError(
        "invalid_tool_pair",
        `MoA advisor policy-profile pair is invalid: ${String(input.toolPolicy)} + ${String(input.capabilityProfile)}.`,
      )
    case "aggregator":
      if (input.toolPolicy === "none" && input.capabilityProfile === "moa-consultation-only") return
      throw new MoALaunchContractError("invalid_tool_pair", "MoA aggregator must remain tool-free.")
    default:
      throw new MoALaunchContractError("unknown_role", `Unknown MoA child role: ${String(input.role)}`)
  }
}

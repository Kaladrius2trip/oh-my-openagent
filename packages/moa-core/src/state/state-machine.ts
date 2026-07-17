import type { MoARunStatus } from "../types"

export const MOA_TERMINAL_STATUSES = ["completed", "degraded", "failed", "timed_out", "cancelled"] as const
export type MoATerminalStatus = (typeof MOA_TERMINAL_STATUSES)[number]

const TERMINAL_SET = new Set<MoARunStatus>(MOA_TERMINAL_STATUSES)

/** Allowed forward transitions. Every non-terminal status may also transition to
 * `cancelled` via a parent abort; that edge is added below rather than repeated. */
export const MOA_ALLOWED_TRANSITIONS: Record<MoARunStatus, readonly MoARunStatus[]> = {
  created: ["resolving", "cancelled"],
  resolving: ["advising", "failed", "cancelled"],
  advising: ["aggregating", "failed", "timed_out", "cancelled"],
  aggregating: ["completed", "degraded", "failed", "timed_out", "cancelled"],
  completed: [],
  degraded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
}

export function isTerminalStatus(status: MoARunStatus): status is MoATerminalStatus {
  return TERMINAL_SET.has(status)
}

export function canTransition(from: MoARunStatus, to: MoARunStatus): boolean {
  return MOA_ALLOWED_TRANSITIONS[from].includes(to)
}

export class InvalidMoATransitionError extends Error {
  constructor(
    readonly from: MoARunStatus,
    readonly to: MoARunStatus,
  ) {
    super(`Invalid MoA run transition: ${from} -> ${to}`)
    this.name = "InvalidMoATransitionError"
  }
}

export function assertTransition(from: MoARunStatus, to: MoARunStatus): void {
  if (!canTransition(from, to)) throw new InvalidMoATransitionError(from, to)
}

export interface TerminalStatusInput {
  /** Parent abort overrides every other outcome. */
  cancelled?: boolean
  /** Whether the successful advisor count met `min_successful_advisors`. */
  advisorThresholdMet: boolean
  /** Below-threshold outcome was caused by the shared deadline rather than errors. */
  advisorTimedOut?: boolean
  /** Every launched advisor settled successfully. */
  allAdvisorsSucceeded?: boolean
  /** Effective diversity outcome after applying the configured violation policy. */
  effectiveDiversity: "satisfied" | "degraded" | "failed"
  /** Whether the aggregator was launched (skipped on threshold or diversity fail). */
  aggregatorLaunched: boolean
  /** Aggregator settled successfully. Ignored when the aggregator never launched. */
  aggregatorSucceeded?: boolean
  /** Aggregator failure may still yield a degraded bundle when advisor reports are usable. */
  allowDegradedBundle?: boolean
  /** Aggregator failure was caused by its own deadline. */
  aggregatorTimedOut?: boolean
}

/** Encodes the terminal policy table from spec section 6. */
export function computeTerminalStatus(input: TerminalStatusInput): MoATerminalStatus {
  if (input.cancelled === true) return "cancelled"

  if (!input.advisorThresholdMet) {
    return input.advisorTimedOut === true ? "timed_out" : "failed"
  }

  if (input.effectiveDiversity === "failed") return "failed"

  if (!input.aggregatorLaunched) return "failed"

  if (input.aggregatorSucceeded === true) {
    const clean = input.allAdvisorsSucceeded === true && input.effectiveDiversity === "satisfied"
    return clean ? "completed" : "degraded"
  }

  if (input.allowDegradedBundle === true) return "degraded"
  return input.aggregatorTimedOut === true ? "timed_out" : "failed"
}

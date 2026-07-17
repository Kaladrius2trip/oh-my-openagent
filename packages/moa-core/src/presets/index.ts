import type { MoAPresetConfig } from "../types"
import { architectureBalancedPreset } from "./architecture-balanced"
import { budgetPreset } from "./budget"
import { codeReviewPreset } from "./code-review"
import { decisionFastPreset } from "./decision-fast"
import { hermesLikeFrontierPreset } from "./hermes-like-frontier"
import { planningRigorousPreset } from "./planning-rigorous"
import { securityCriticalPreset } from "./security-critical"

export const DEFAULT_PRESET_NAME = "architecture-balanced"

export const BUILTIN_PRESETS: Record<string, MoAPresetConfig> = {
  "architecture-balanced": architectureBalancedPreset,
  "hermes-like-frontier": hermesLikeFrontierPreset,
  "code-review": codeReviewPreset,
  "planning-rigorous": planningRigorousPreset,
  "security-critical": securityCriticalPreset,
  "decision-fast": decisionFastPreset,
  budget: budgetPreset,
}

export {
  architectureBalancedPreset,
  budgetPreset,
  codeReviewPreset,
  decisionFastPreset,
  hermesLikeFrontierPreset,
  planningRigorousPreset,
  securityCriticalPreset,
}
export * from "./validate-preset"

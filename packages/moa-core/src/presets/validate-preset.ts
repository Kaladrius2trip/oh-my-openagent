import { MOA_ADVISOR_MODES, MOA_ADVISOR_ROLES, type MoAPresetConfig } from "../types"

export interface PresetValidationError {
  code: string
  message: string
}

export interface ValidatePresetOptions {
  /** Hard cap on advisors per run. Defaults to 8. */
  maxAdvisors?: number
}

const DEFAULT_MAX_ADVISORS = 8
const KNOWN_ROLES = new Set<string>(MOA_ADVISOR_ROLES)
const KNOWN_MODES = new Set<string>(MOA_ADVISOR_MODES)

function hasCategory(advisor: MoAPresetConfig["advisors"][number]): boolean {
  return "category" in advisor && typeof advisor.category === "string" && advisor.category.length > 0
}

function hasSubagent(advisor: MoAPresetConfig["advisors"][number]): boolean {
  return "subagent_type" in advisor && typeof advisor.subagent_type === "string" && advisor.subagent_type.length > 0
}

/**
 * Structural validation of a MoA preset per spec section 3.7. Returns an empty
 * array when the preset is valid, otherwise one entry per violation. This is
 * harness-neutral: it validates shape and policy, never runtime availability.
 */
export function validatePreset(preset: MoAPresetConfig, options: ValidatePresetOptions = {}): PresetValidationError[] {
  const maxAdvisors = options.maxAdvisors ?? DEFAULT_MAX_ADVISORS
  const errors: PresetValidationError[] = []
  const advisors = preset.advisors ?? []

  if (advisors.length === 0) {
    errors.push({ code: "no_advisors", message: "A preset must define at least one advisor." })
  }
  if (advisors.length > maxAdvisors) {
    errors.push({
      code: "too_many_advisors",
      message: `A preset must define at most ${maxAdvisors} advisors, found ${advisors.length}.`,
    })
  }

  const seenNames = new Set<string>()
  for (const advisor of advisors) {
    if (seenNames.has(advisor.name)) {
      errors.push({ code: "duplicate_advisor_name", message: `Duplicate advisor name "${advisor.name}".` })
    }
    seenNames.add(advisor.name)

    if (hasCategory(advisor) === hasSubagent(advisor)) {
      errors.push({
        code: "invalid_target",
        message: `Advisor "${advisor.name}" must set exactly one of category or subagent_type.`,
      })
    }
    if (advisor.role !== undefined && !KNOWN_ROLES.has(advisor.role)) {
      errors.push({ code: "unknown_role", message: `Advisor "${advisor.name}" has unknown role "${advisor.role}".` })
    }
    if (advisor.mode !== undefined && !KNOWN_MODES.has(advisor.mode)) {
      errors.push({ code: "unknown_mode", message: `Advisor "${advisor.name}" has unknown mode "${advisor.mode}".` })
    }
    if (
      advisor.tool_policy !== undefined
      && advisor.tool_policy !== "none"
      && advisor.tool_policy !== "read_only"
    ) {
      errors.push({
        code: "invalid_tool_policy",
        message: `Advisor "${advisor.name}" must use tool_policy "none" or "read_only".`,
      })
    }
  }

  if (preset.execution_policy !== undefined && preset.execution_policy !== "consultation_only") {
    errors.push({
      code: "invalid_execution_policy",
      message: `Execution policy must be "consultation_only", found "${preset.execution_policy}".`,
    })
  }

  const minSuccess = preset.min_successful_advisors
  if (minSuccess !== undefined && (minSuccess < 1 || minSuccess > advisors.length)) {
    errors.push({
      code: "invalid_min_success",
      message: `min_successful_advisors must be between 1 and ${advisors.length}, found ${minSuccess}.`,
    })
  }

  const diversity = preset.diversity
  if (diversity !== undefined) {
    const providers = diversity.min_distinct_providers ?? 0
    const models = diversity.min_distinct_models ?? 0
    if (providers > advisors.length || models > advisors.length) {
      errors.push({
        code: "diversity_exceeds_advisors",
        message: `Diversity thresholds must not exceed the advisor count (${advisors.length}).`,
      })
    }
  }

  if (preset.aggregator === undefined) {
    errors.push({ code: "missing_aggregator", message: "A preset must define exactly one aggregator." })
  }

  return errors
}

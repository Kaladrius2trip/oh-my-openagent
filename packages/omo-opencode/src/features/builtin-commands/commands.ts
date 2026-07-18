import type { CommandDefinition } from "../claude-code-command-loader"
import { isAgentRegistered } from "../claude-code-session-state"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { GOAL_TEMPLATE } from "./templates/goal"
import { STOP_CONTINUATION_TEMPLATE } from "./templates/stop-continuation"
import { REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM } from "./templates/refactor"
import { START_WORK_TEMPLATE } from "./templates/start-work"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { REMOVE_AI_SLOPS_TEMPLATE, REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM } from "./templates/remove-ai-slops"
import { HYPERPLAN_TEMPLATE } from "./templates/hyperplan"

interface LoadBuiltinCommandsOptions {
  useRegisteredAgents?: boolean
  teamModeEnabled?: boolean
  moaEnabled?: boolean
}

function resolveStartWorkAgent(options?: LoadBuiltinCommandsOptions): "atlas" | "sisyphus" {
  if (options?.useRegisteredAgents) {
    return isAgentRegistered("atlas") ? "atlas" : "sisyphus"
  }

  return "atlas"
}

function withTeamModeAddendum(baseTemplate: string, addendum: string, teamModeEnabled: boolean): string {
  return teamModeEnabled ? `${baseTemplate}\n${addendum}` : baseTemplate
}

function createBuiltinCommandDefinitions(
  options?: LoadBuiltinCommandsOptions,
): Record<BuiltinCommandName, Omit<CommandDefinition, "name">> {
  const teamModeEnabled = options?.teamModeEnabled ?? false
  const refactorContent = withTeamModeAddendum(REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM, teamModeEnabled)
  const removeAiSlopsContent = withTeamModeAddendum(
    REMOVE_AI_SLOPS_TEMPLATE,
    REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM,
    teamModeEnabled,
  )

  return {
    goal: {
      description: "(builtin) Set, show, pause, resume, or clear the active thread goal",
      template: `<command-instruction>
${GOAL_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
      argumentHint: "<objective> | pause | resume | clear",
    },
    refactor: {
      description:
        "(builtin) Intelligent refactoring command with LSP, AST-grep, architecture analysis, codemap, and TDD verification.",
      template: `<command-instruction>
${refactorContent}
</command-instruction>`,
      argumentHint: "<refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]",
    },
    "start-work": {
      description: "(builtin) Start Atlas work session from Prometheus plan",
      agent: resolveStartWorkAgent(options),
      template: `<command-instruction>
${START_WORK_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[plan-name]",
    },
    "stop-continuation": {
      description: "(builtin) Stop all continuation mechanisms (ralph loop, todo continuation, boulder) for this session",
      template: `<command-instruction>
${STOP_CONTINUATION_TEMPLATE}
</command-instruction>`,
    },
    "remove-ai-slops": {
      description: "(builtin) Remove AI-generated code smells from branch changes and critically review the results",
      template: `<command-instruction>
${removeAiSlopsContent}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    },
    handoff: {
      description: "(builtin) Create a detailed context summary for continuing work in a new session",
      template: `<command-instruction>
${HANDOFF_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[goal]",
    },
    hyperplan: {
      description: "(builtin) Adversarial multi-agent planning via team-mode (5 hostile category members cross-critique, lead synthesizes)",
      template: `<command-instruction>
${HYPERPLAN_TEMPLATE}
</command-instruction>`,
      argumentHint: "[planning-request]",
    },
    moa: {
      description:
        "(builtin) Consult the Mixture of Advisors panel for a synthesized decision bundle (advisors are consultation-only; the parent implements)",
      template: `<command-instruction>
The user invoked /moa. Mixture of Advisors (MoA) fans a question out to a panel of tool-free advisor models plus one aggregator and returns a synthesized decision bundle. Advisors never read or write files; you, the parent agent, keep all implementation authority.

Parse <user-request> for an optional leading inline flag before calling the moa_consult tool:
- If it contains "--preset <name>" (or "--preset=<name>"), pass <name> as the moa_consult preset argument and strip the flag from the text that becomes the prompt.
- If no --preset flag is present, omit the preset argument so the configured default preset applies.
- Everything left after removing the flag is the moa_consult prompt.

When the remaining request text is non-empty, call the moa_consult tool with that text as its prompt (and the parsed preset, if any), then act on the returned decision bundle yourself.

When the remaining request text is empty, explain what /moa does, list that a preset can be chosen with --preset <name>, and ask the user for the decision or design question to consult on.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[--preset <name>] <decision or design question>",
    },
  }
}

export function loadBuiltinCommands(
  disabledCommands?: BuiltinCommandName[],
  options?: LoadBuiltinCommandsOptions,
): BuiltinCommands {
  const builtinCommandDefinitions = createBuiltinCommandDefinitions(options)
  const disabled = new Set(disabledCommands ?? [])
  if (options?.moaEnabled !== true) disabled.add("moa")
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(builtinCommandDefinitions)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}

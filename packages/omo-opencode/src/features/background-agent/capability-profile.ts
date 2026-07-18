import { getAgentToolRestrictions } from "../../shared"
import type {
  BackgroundTaskCapabilityProfile,
  BackgroundTaskToolPolicy,
  BackgroundTaskUserPermission,
} from "./types"

type AgentToolRestrictionsResolver = (
  agent: string,
  options: { readonly includeTeamToolDenylist: boolean },
) => Record<string, boolean>

export interface CapabilityProfileInput {
  readonly agent: string
  readonly includeTeamToolDenylist: boolean
  readonly userPermission?: BackgroundTaskUserPermission
  readonly toolPolicy?: BackgroundTaskToolPolicy
  readonly capabilityProfile?: BackgroundTaskCapabilityProfile
}

export type CapabilityProfileResolver = (
  input: CapabilityProfileInput,
) => Record<string, boolean>

export class CapabilityProfileError extends Error {
  readonly name = "CapabilityProfileError"

  constructor(readonly reason: "conflict" | "unknown" | "unsupported", message: string) {
    super(message)
  }
}

const DENY_ALL_TOOLS = { "*": false } as const

function resolvePinnedProfile(input: CapabilityProfileInput): Record<string, boolean> | undefined {
  const profile = input.capabilityProfile
  if (profile === undefined) return input.toolPolicy === "none" ? DENY_ALL_TOOLS : undefined

  switch (profile) {
    case "moa-consultation-only":
      if (input.toolPolicy === "default") {
        throw new CapabilityProfileError(
          "conflict",
          'Conflicting capability profile "moa-consultation-only" and tool policy "default".',
        )
      }
      return DENY_ALL_TOOLS
    case "moa-research":
      if (input.toolPolicy === "none") {
        throw new CapabilityProfileError(
          "conflict",
          'Conflicting capability profile "moa-research" and tool policy "none".',
        )
      }
      throw new CapabilityProfileError("unsupported", 'Capability profile "moa-research" is not available yet.')
    default:
      throw new CapabilityProfileError("unknown", `Unknown capability profile: ${String(profile)}`)
  }
}

export function createCapabilityProfileResolver(
  resolveAgentToolRestrictions: AgentToolRestrictionsResolver = getAgentToolRestrictions,
): CapabilityProfileResolver {
  return (input) => {
    const pinnedProfile = resolvePinnedProfile(input)
    if (pinnedProfile !== undefined) return pinnedProfile

    const userDeniedTools: Record<string, boolean> = {}
    for (const [tool, permission] of Object.entries(input.userPermission ?? {})) {
      if (permission === "deny") {
        userDeniedTools[tool] = false
      }
    }

    return {
      task: false,
      call_omo_agent: true,
      question: false,
      ...userDeniedTools,
      ...resolveAgentToolRestrictions(input.agent, {
        includeTeamToolDenylist: input.includeTeamToolDenylist,
      }),
    }
  }
}

export const resolveCapabilityProfile = createCapabilityProfileResolver()

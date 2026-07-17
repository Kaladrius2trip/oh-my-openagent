import { getAgentToolRestrictions } from "../../shared"
import type {
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
  readonly capabilityProfile?: string
}

export type CapabilityProfileResolver = (
  input: CapabilityProfileInput,
) => Record<string, boolean>

export function createCapabilityProfileResolver(
  resolveAgentToolRestrictions: AgentToolRestrictionsResolver = getAgentToolRestrictions,
): CapabilityProfileResolver {
  return (input) => {
    if (
      input.capabilityProfile === "moa-consultation-only"
      || input.toolPolicy === "none"
    ) {
      return {}
    }

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

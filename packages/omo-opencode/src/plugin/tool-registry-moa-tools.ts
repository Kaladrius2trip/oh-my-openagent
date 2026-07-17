import type { ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import { normalizeMoAConfig } from "../features/moa"
import type { ToolRegistryFactories } from "./tool-registry-factories"

export function createMoaToolsRecord(args: {
  readonly pluginConfig: Pick<OhMyOpenCodeConfig, "moa">
  readonly managers: Pick<Managers, "moaManager">
  readonly factories: Pick<ToolRegistryFactories, "createMoaConsultTool">
}): Record<string, ToolDefinition> {
  const { pluginConfig, managers, factories } = args
  if (!pluginConfig.moa?.enabled || !managers.moaManager) return {}

  return {
    moa_consult: factories.createMoaConsultTool(managers.moaManager, normalizeMoAConfig(pluginConfig.moa)),
  }
}

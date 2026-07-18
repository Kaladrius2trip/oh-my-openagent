import type { MoAConfig } from "@oh-my-opencode/moa-core"
import { BUILTIN_PRESETS, DEFAULT_PRESET_NAME } from "@oh-my-opencode/moa-core/presets"

export type MoAPresetProvenance = "built-in" | "custom" | "override"

export type MoAPresetRow = {
  readonly name: string
  readonly active: boolean
  readonly provenance: MoAPresetProvenance
  readonly disabled: boolean
  readonly advisorCount: number
  readonly description: string
}

export function buildPresetRows(config: MoAConfig | undefined): readonly MoAPresetRow[] {
  const customPresets = config?.presets ?? {}
  const presets = { ...BUILTIN_PRESETS, ...customPresets }
  const activePreset = config?.default_preset ?? DEFAULT_PRESET_NAME

  return Object.keys(presets).sort().map((name) => {
    const preset = presets[name]
    if (preset === undefined) return undefined
    const custom = Object.hasOwn(customPresets, name)
    const builtin = Object.hasOwn(BUILTIN_PRESETS, name)
    return {
      name,
      active: name === activePreset,
      provenance: custom ? (builtin ? "override" : "custom") : "built-in",
      disabled: preset.enabled === false,
      advisorCount: preset.advisors.length,
      description: preset.description ?? "",
    } satisfies MoAPresetRow
  }).filter((row): row is MoAPresetRow => row !== undefined)
}

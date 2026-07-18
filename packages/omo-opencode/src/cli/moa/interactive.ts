import * as p from "@clack/prompts"
import { validatePluginConfig } from "../../config/validate"
import { buildPresetRows } from "./preset-list"
import { runMoaList, runMoaUse, runMoaValidate } from "./actions"

type InteractiveAction = "list" | "use" | "validate"

async function selectAction(): Promise<InteractiveAction | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Interactive terminal required. Use `omo moa list`, `use`, or `validate`.")
    return null
  }
  const action = await p.select<InteractiveAction>({
    message: "MoA preset action",
    options: [
      { value: "list", label: "List presets" },
      { value: "use", label: "Set active preset" },
      { value: "validate", label: "Validate configuration" },
    ],
  })
  if (p.isCancel(action)) {
    p.cancel("MoA configuration cancelled.")
    return null
  }
  return action
}

async function selectPreset(message: string): Promise<string | null> {
  const validation = validatePluginConfig(process.cwd())
  if (!validation.valid) {
    for (const error of validation.messages) console.error(`Error: ${error}`)
    return null
  }
  const rows = buildPresetRows(validation.config.moa).filter((row) => !row.disabled)
  const selected = await p.select<string>({
    message,
    options: rows.map((row) => ({
      value: row.name,
      label: row.name,
      hint: `${row.provenance}, ${row.advisorCount} advisors`,
    })),
    initialValue: validation.config.moa?.default_preset,
  })
  if (p.isCancel(selected)) {
    p.cancel("MoA configuration cancelled.")
    return null
  }
  return selected
}

export async function runMoaInteractive(): Promise<number> {
  const action = await selectAction()
  if (action === null) return 1
  switch (action) {
    case "list":
      return runMoaList()
    case "validate": {
      const preset = await selectPreset("Preset to validate")
      return preset === null ? 1 : runMoaValidate(preset)
    }
    case "use": {
      const preset = await selectPreset("Preset to activate")
      if (preset === null) return 1
      const validation = validatePluginConfig(process.cwd())
      let enable = false
      if (validation.config.moa?.enabled !== true) {
        const confirmed = await p.confirm({
          message: "Enable MoA with this preset?",
          initialValue: false,
        })
        if (p.isCancel(confirmed)) {
          p.cancel("MoA configuration cancelled.")
          return 1
        }
        enable = confirmed
      }
      return runMoaUse(preset, { enable })
    }
    default:
      return 1
  }
}

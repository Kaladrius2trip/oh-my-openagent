import { Command } from "commander"
import { runMoaList, runMoaUse, runMoaValidate } from "./actions"
import { runMoaInteractive } from "./interactive"

type JsonOptions = { readonly json?: boolean }
type UseOptions = { readonly enable?: boolean }

export function createMoaCommand(): Command {
  const moa = new Command("moa")
    .description("Inspect and configure Mixture of Advisors presets")
    .action(async () => {
      process.exitCode = await runMoaInteractive()
    })

  moa
    .command("list")
    .description("List effective MoA presets")
    .option("--json", "Output structured JSON")
    .action((options: JsonOptions) => {
      process.exitCode = runMoaList(options)
    })

  moa
    .command("use <preset>")
    .description("Set the active default MoA preset in user config")
    .option("--enable", "Also enable MoA explicitly")
    .action((preset: string, options: UseOptions) => {
      process.exitCode = runMoaUse(preset, options)
    })

  moa
    .command("validate [preset]")
    .description("Validate effective MoA configuration")
    .option("--json", "Output structured JSON")
    .action((preset: string | undefined, options: JsonOptions) => {
      process.exitCode = runMoaValidate(preset, options)
    })

  return moa
}

export { runMoaList, runMoaUse, runMoaValidate }

import { describe, expect, test } from "bun:test"
import { createMoaCommand } from "./index"

describe("moa command", () => {
  test("#given command group #when inspected #then list use and validate subcommands are registered", () => {
    // given
    const command = createMoaCommand()

    // when
    const names = command.commands.map((subcommand) => subcommand.name())

    // then
    expect(command.name()).toBe("moa")
    expect(names).toEqual(["list", "use", "validate"])
  })

  test("#given scriptable subcommands #when inspected #then JSON and explicit enable flags are exposed", () => {
    // given
    const command = createMoaCommand()
    const list = command.commands.find((subcommand) => subcommand.name() === "list")
    const use = command.commands.find((subcommand) => subcommand.name() === "use")
    const validate = command.commands.find((subcommand) => subcommand.name() === "validate")

    // when
    const listOptions = list?.options.map((option) => option.long)
    const useOptions = use?.options.map((option) => option.long)
    const validateOptions = validate?.options.map((option) => option.long)

    // then
    expect(listOptions).toContain("--json")
    expect(useOptions).toContain("--enable")
    expect(validateOptions).toContain("--json")
  })
})

import { describe, expect, test } from "bun:test"

import { loadBuiltinCommands } from "./commands"

describe("loadBuiltinCommands - moa gating", () => {
  test("does not register /moa when moa is disabled", () => {
    // Given moa explicitly disabled
    const commands = loadBuiltinCommands(undefined, { moaEnabled: false })
    // Then the command is not registered at all
    expect(commands.moa).toBeUndefined()
  })

  test("does not register /moa when options omit moa (default inert)", () => {
    // Given no options (default state)
    const commands = loadBuiltinCommands()
    // Then /moa is absent
    expect(commands.moa).toBeUndefined()
  })

  test("registers /moa when moa is enabled", () => {
    // Given moa enabled
    const commands = loadBuiltinCommands(undefined, { moaEnabled: true })
    // Then /moa is registered
    expect(commands.moa).toBeDefined()
    expect(commands.moa?.name).toBe("moa")
  })

  test("the /moa template dispatches moa_consult with the user arguments", () => {
    // Given moa enabled
    const commands = loadBuiltinCommands(undefined, { moaEnabled: true })
    // Then the template routes to the moa_consult tool and substitutes arguments
    const template = commands.moa?.template ?? ""
    expect(template).toContain("moa_consult")
    expect(template).toContain("$ARGUMENTS")
  })

  test("respects disabled_commands even when moa is enabled", () => {
    // Given moa enabled but /moa listed in disabled_commands
    const commands = loadBuiltinCommands(["moa"], { moaEnabled: true })
    // Then it stays unregistered
    expect(commands.moa).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("BuiltinCommandNameSchema", () => {
  test("#given moa is disabled by command name #when config is parsed #then validation succeeds", () => {
    // given
    const config = { disabled_commands: ["moa"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })
})

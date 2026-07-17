/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"

import { tool } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "../config"
import { createToolRegistry } from "./tool-registry"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

function baseFactories() {
  return {
    createBackgroundTools: mock(() => ({})),
    createCallOmoAgent: mock(() => fakeTool),
    createLookAt: mock(() => fakeTool),
    createSkillMcpTool: mock(() => fakeTool),
    createSkillTool: mock(() => fakeTool),
    createGrepTools: mock(() => ({})),
    createGlobTools: mock(() => ({})),
    createSessionManagerTools: mock(() => ({})),
    createDelegateTask: mock(() => fakeTool),
    discoverCommandsSync: mock(() => []),
    interactive_bash: fakeTool,
    createTaskCreateTool: mock(() => fakeTool),
    createTaskGetTool: mock(() => fakeTool),
    createTaskList: mock(() => fakeTool),
    createTaskUpdateTool: mock(() => fakeTool),
    createHashlineEditTool: mock(() => fakeTool),
    createMoaConsultTool: mock(() => fakeTool),
  }
}

function buildRegistry(options: { readonly moaEnabled: boolean; readonly withManager: boolean }) {
  const pluginConfig = OhMyOpenCodeConfigSchema.parse({
    git_master: { commit_footer: false, include_co_authored_by: false, git_env_prefix: "" },
    ...(options.moaEnabled ? { moa: { enabled: true } } : {}),
  })
  return createToolRegistry({
    ctx: { directory: "/tmp/moa", client: {} } as Parameters<typeof createToolRegistry>[0]["ctx"],
    pluginConfig,
    managers: {
      backgroundManager: {},
      tmuxSessionManager: {},
      skillMcpManager: {},
      ...(options.withManager ? { moaManager: {} } : {}),
    } as Parameters<typeof createToolRegistry>[0]["managers"],
    skillContext: {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: "playwright",
      disabledSkills: new Set(),
    },
    availableCategories: [],
    toolFactories: baseFactories(),
  })
}

describe("moa tool registry wiring", () => {
  test("registers moa_consult when moa is enabled and the manager is present", () => {
    // Given moa enabled and a constructed manager
    // When the registry is built
    const result = buildRegistry({ moaEnabled: true, withManager: true })
    // Then moa_consult is available
    expect(result.filteredTools).toHaveProperty("moa_consult")
  })

  test("omits moa_consult when moa is disabled (default)", () => {
    // Given moa absent from config
    const result = buildRegistry({ moaEnabled: false, withManager: true })
    // Then moa_consult is not registered
    expect(result.filteredTools).not.toHaveProperty("moa_consult")
  })

  test("omits moa_consult when enabled but the manager was not constructed", () => {
    // Given moa enabled but no manager (e.g. construction skipped)
    const result = buildRegistry({ moaEnabled: true, withManager: false })
    // Then moa_consult is not registered
    expect(result.filteredTools).not.toHaveProperty("moa_consult")
  })
})

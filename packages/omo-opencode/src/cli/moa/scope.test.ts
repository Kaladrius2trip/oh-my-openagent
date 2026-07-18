import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveMoaUserScope } from "./scope"

const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
const originalHome = process.env.HOME

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

function sandbox(): { readonly home: string; readonly project: string; readonly userConfig: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-moa-scope-"))
  const home = join(root, "home")
  const project = join(home, "project")
  const userConfig = join(root, "custom-opencode")
  mkdirSync(project, { recursive: true })
  process.env.HOME = home
  process.env.OPENCODE_CONFIG_DIR = userConfig
  return { home, project, userConfig }
}

describe("resolveMoaUserScope", () => {
  test("#given OPENCODE_CONFIG_DIR #when no plugin config exists #then new JSONC path uses custom directory", () => {
    // given
    const fixture = sandbox()

    // when
    const result = resolveMoaUserScope({ cwd: fixture.project })

    // then
    expect(result).toEqual({
      kind: "ready",
      path: join(fixture.userConfig, "oh-my-openagent.jsonc"),
    })
  })

  test("#given existing canonical JSON #when scope resolves #then writer keeps JSON path", () => {
    // given
    const fixture = sandbox()
    mkdirSync(fixture.userConfig, { recursive: true })
    const jsonPath = join(fixture.userConfig, "oh-my-openagent.json")
    writeFileSync(jsonPath, "{}\n")

    // when
    const result = resolveMoaUserScope({ cwd: fixture.project })

    // then
    expect(result).toEqual({ kind: "ready", path: jsonPath })
  })

  test("#given project MoA config #when user scope resolves #then controlling path refuses write", () => {
    // given
    const fixture = sandbox()
    const configPath = join(fixture.project, ".opencode", "oh-my-openagent.jsonc")
    mkdirSync(join(fixture.project, ".opencode"), { recursive: true })
    writeFileSync(configPath, `{"moa":{"enabled":true}}\n`)

    // when
    const result = resolveMoaUserScope({ cwd: fixture.project })

    // then
    expect(result).toEqual({ kind: "shadowed", path: configPath })
  })
})

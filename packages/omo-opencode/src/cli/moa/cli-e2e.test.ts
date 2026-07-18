import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseJsonc } from "../../shared"

test("#given isolated disabled config #when omo moa use selects a built-in #then default changes without enabling and comments survive", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-moa-cli-e2e-"))
  const home = join(root, "home")
  const xdg = join(root, "xdg")
  const project = join(home, "project")
  const configPath = join(xdg, "opencode", "oh-my-openagent.jsonc")
  mkdirSync(project, { recursive: true })
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `{
  // keep this comment
  "moa": {
    "enabled": false
  },
  "unrelated": true
}
`)
  const cliPath = fileURLToPath(new URL("../index.ts", import.meta.url))

  // when
  const result = Bun.spawnSync({
    cmd: [process.execPath, cliPath, "moa", "use", "budget"],
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: xdg,
      OPENCODE_CONFIG_DIR: join(xdg, "opencode"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  // then
  const content = readFileSync(configPath, "utf-8")
  const config = parseJsonc<{ readonly moa?: { readonly enabled?: boolean; readonly default_preset?: string } }>(content)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toContain("Restart OpenCode")
  expect(content).toContain("// keep this comment")
  expect(content).toContain('"unrelated": true')
  expect(config.moa).toEqual({ enabled: false, default_preset: "budget" })
})

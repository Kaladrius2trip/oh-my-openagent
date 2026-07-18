import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_WRITE_FILE_SYSTEM,
  OmoConfigWriteError,
  updateJsoncFile,
} from "../index"

function makeFixture(content: string): {
  readonly configPath: string
  readonly original: string
} {
  const root = mkdtempSync(join(tmpdir(), "omo-jsonc-writer-"))
  const configPath = join(root, "oh-my-openagent.jsonc")
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, content)
  return { configPath, original: content }
}

describe("updateJsoncFile", () => {
  test("#given commented config #when editing a nested value #then comments and unrelated keys survive", () => {
    // given
    const fixture = makeFixture(`{
  // keep this explanation
  "moa": { "enabled": false },
  "unrelated": { "value": 7 }
}
`)

    // when
    updateJsoncFile({
      path: fixture.configPath,
      edits: [{ path: ["moa", "default_preset"], value: "code-review" }],
    })

    // then
    const content = readFileSync(fixture.configPath, "utf-8")
    expect(content).toContain("// keep this explanation")
    expect(content).toContain('"enabled": false')
    expect(content).toContain('"default_preset": "code-review"')
    expect(content).toContain('"unrelated": { "value": 7 }')
  })

  test("#given existing config #when editing #then original bytes are backed up", () => {
    // given
    const fixture = makeFixture(`{"moa":{"enabled":false}}\n`)

    // when
    const result = updateJsoncFile({
      path: fixture.configPath,
      edits: [{ path: ["moa", "default_preset"], value: "budget" }],
    })

    // then
    expect(result.backupPath).toBeDefined()
    expect(readFileSync(result.backupPath ?? "", "utf-8")).toBe(fixture.original)
  })

  test("#given malformed config #when editing #then typed error leaves original bytes unchanged", () => {
    // given
    const fixture = makeFixture(`{"moa":`)

    // when
    const run = (): void => {
      updateJsoncFile({
        path: fixture.configPath,
        edits: [{ path: ["moa", "default_preset"], value: "budget" }],
      })
    }

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(fixture.original)
  })

  test("#given atomic write failure #when editing #then typed error leaves original bytes unchanged", () => {
    // given
    const fixture = makeFixture(`{"moa":{"enabled":false}}\n`)

    // when
    const run = (): void => {
      updateJsoncFile({
        path: fixture.configPath,
        edits: [{ path: ["moa", "default_preset"], value: "budget" }],
        fileSystem: {
          ...DEFAULT_WRITE_FILE_SYSTEM,
          writeFileExclusiveSync: (path, content) => {
            if (path.includes(".bak.")) {
              DEFAULT_WRITE_FILE_SYSTEM.writeFileExclusiveSync(path, content)
              return
            }
            throw new Error("EACCES synthetic")
          },
        },
      })
    }

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(fixture.original)
  })
})

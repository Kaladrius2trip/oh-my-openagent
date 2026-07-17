import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { CONFIG_BASENAME } from "../../../shared/plugin-identity"
import { getAllCheckDefinitions } from "./index"

const ORIGINAL_CWD = process.cwd()
let sandbox = ""

async function writeConfig(config: object): Promise<void> {
  const configDir = path.join(sandbox, ".opencode")
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, `${CONFIG_BASENAME}.jsonc`), JSON.stringify(config))
}

function getMoACheck() {
  const definition = getAllCheckDefinitions().find((candidate) => candidate.id === "moa")
  if (definition === undefined) throw new Error("MoA doctor check is not registered")
  return definition.check
}

function enabledConfig(fallbackModels: readonly [string, string]) {
  return {
    moa: {
      enabled: true,
      default_preset: "doctor-fixture",
      presets: {
        "doctor-fixture": {
          execution_policy: "consultation_only",
          advisors: [
            { name: "architect", category: "doctor-a", tool_policy: "none" },
            { name: "validator", category: "doctor-b", tool_policy: "none" },
          ],
          aggregator: { category: "doctor-aggregator" },
          diversity: {
            min_distinct_providers: 2,
            min_distinct_models: 2,
            on_effective_violation: "degrade",
          },
        },
      },
    },
    categories: {
      "doctor-a": { model: "anthropic/doctor-a", fallback_models: [fallbackModels[0]] },
      "doctor-b": { model: "google/doctor-b", fallback_models: [fallbackModels[1]] },
      "doctor-aggregator": { model: "openai/doctor-aggregator" },
    },
  }
}

describe("MoA doctor check", () => {
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "omo-moa-doctor-"))
    process.chdir(sandbox)
  })

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD)
    await rm(sandbox, { recursive: true, force: true })
  })

  test("#given MoA is disabled #when doctor runs #then check is skipped", async () => {
    // given
    await writeConfig({ moa: { enabled: false } })

    // when
    const result = await getMoACheck()()

    // then
    expect(result.status).toBe("skip")
    expect(result.message).toContain("moa: disabled")
  })

  test("#given provider-distinct fallback chains #when doctor runs #then check passes with primary diversity", async () => {
    // given
    await writeConfig(enabledConfig(["anthropic/doctor-a-fallback", "google/doctor-b-fallback"]))

    // when
    const result = await getMoACheck()()

    // then
    expect(result.status).toBe("pass")
    expect(result.message).toContain("primary diversity: 2 providers, 2 models")
  })

  test("#given fallback chains collapse on OpenAI #when doctor runs #then check warns with provider name", async () => {
    // given
    await writeConfig(enabledConfig(["openai/shared-fallback", "openai/shared-fallback"]))

    // when
    const result = await getMoACheck()()

    // then
    expect(result.status).toBe("warn")
    expect(result.message).toContain("openai")
  })

  test("#given missing default preset #when doctor runs #then check fails", async () => {
    // given
    await writeConfig({ moa: { enabled: true, default_preset: "missing" } })

    // when
    const result = await getMoACheck()()

    // then
    expect(result.status).toBe("fail")
    expect(result.message).toContain("missing")
  })
})

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { CONFIG_BASENAME } from "../../../shared/plugin-identity"
import { checkMoA } from "./moa"

const ORIGINAL_CWD = process.cwd()
let sandbox = ""

async function writeConfig(config: object): Promise<void> {
  const configDir = path.join(sandbox, ".opencode")
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, `${CONFIG_BASENAME}.jsonc`), JSON.stringify(config))
}

function getMoACheck() {
  return checkMoA
}

function enabledConfig(
  fallbackModels: readonly [string, string],
  options: {
    readonly advisorModel?: string
    readonly advisorTemperature?: number
    readonly aggregatorModel?: string
    readonly aggregatorTemperature?: number
  } = {},
) {
  return {
    moa: {
      enabled: true,
      default_preset: "doctor-fixture",
      presets: {
        "doctor-fixture": {
          execution_policy: "consultation_only",
          advisors: [
            {
              name: "architect",
              category: "doctor-a",
              tool_policy: "none",
              ...(options.advisorTemperature !== undefined ? { temperature: options.advisorTemperature } : {}),
            },
            { name: "validator", category: "doctor-b", tool_policy: "none" },
          ],
          aggregator: {
            category: "doctor-aggregator",
            ...(options.aggregatorTemperature !== undefined ? { temperature: options.aggregatorTemperature } : {}),
          },
          diversity: {
            min_distinct_providers: 2,
            min_distinct_models: 2,
            on_effective_violation: "degrade",
          },
        },
      },
    },
    categories: {
      "doctor-a": { model: options.advisorModel ?? "anthropic/doctor-a", fallback_models: [fallbackModels[0]] },
      "doctor-b": { model: "google/doctor-b", fallback_models: [fallbackModels[1]] },
      "doctor-aggregator": { model: options.aggregatorModel ?? "openai/doctor-aggregator" },
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

  test("#given explicit advisor temperature on a known unsupported primary model #when doctor runs #then it warns", async () => {
    // given
    await writeConfig(enabledConfig(
      ["anthropic/doctor-a-fallback", "google/doctor-b-fallback"],
      { advisorModel: "openai/gpt-5.4", advisorTemperature: 0.8 },
    ))

    // when
    const result = await getMoACheck()()

    // then
    expect(result.status).toBe("warn")
    expect(result.issues).toContainEqual(expect.objectContaining({
      title: "Configured MoA temperature is unsupported",
      affects: ["advisor:architect"],
    }))
  })

  test("#given explicit aggregator temperature on a known unsupported primary model #when doctor runs #then it warns", async () => {
    // given
    await writeConfig(enabledConfig(
      ["anthropic/doctor-a-fallback", "google/doctor-b-fallback"],
      { aggregatorModel: "openai/gpt-5.4", aggregatorTemperature: 0.2 },
    ))

    // when
    const result = await getMoACheck()()

    // then
    expect(result.status).toBe("warn")
    expect(result.issues).toContainEqual(expect.objectContaining({
      title: "Configured MoA temperature is unsupported",
      affects: ["aggregator"],
    }))
  })

  test.each([
    ["supported", "xai/grok-4-fast"],
    ["unknown", "mystery/doctor-unknown"],
  ])("#given explicit temperature on a %s primary model #when doctor runs #then temperature warning stays silent", async (_kind, model) => {
    // given
    await writeConfig(enabledConfig(
      ["anthropic/doctor-a-fallback", "google/doctor-b-fallback"],
      { advisorModel: model, advisorTemperature: 0.8 },
    ))

    // when
    const result = await getMoACheck()()

    // then
    expect(result.issues).not.toContainEqual(expect.objectContaining({
      title: "Configured MoA temperature is unsupported",
    }))
  })
})

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { isPlainRecord } from "@oh-my-opencode/utils"
import {
  containsPath,
  findProjectOpencodePluginConfigFiles,
  getOpenCodeConfigDir,
  parseJsonc,
} from "../../shared"
import { CONFIG_BASENAME } from "../../shared/plugin-identity"

export type MoAUserScope =
  | { readonly kind: "ready"; readonly path: string }
  | { readonly kind: "shadowed"; readonly path: string }
  | { readonly kind: "invalid-project-config"; readonly path: string; readonly message: string }

type ResolveMoaUserScopeOptions = {
  readonly cwd?: string
}

function resolveHomeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir()
}

function projectMoaController(cwd: string): Exclude<MoAUserScope, { readonly kind: "ready" }> | undefined {
  const home = resolveHomeDirectory()
  const stopDirectory = containsPath(home, cwd) ? home : cwd
  const projectConfigs = findProjectOpencodePluginConfigFiles(cwd, stopDirectory)
  for (const configPath of projectConfigs) {
    try {
      const raw = parseJsonc<unknown>(readFileSync(configPath, "utf-8"))
      if (isPlainRecord(raw) && Object.hasOwn(raw, "moa")) {
        return { kind: "shadowed", path: configPath }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "invalid-project-config", path: configPath, message: error.message }
    }
  }
  return undefined
}

export function resolveMoaUserScope(options: ResolveMoaUserScopeOptions = {}): MoAUserScope {
  const cwd = options.cwd ?? process.cwd()
  const controller = projectMoaController(cwd)
  if (controller !== undefined) return controller

  const configDirectory = getOpenCodeConfigDir({ binary: "opencode" })
  const jsoncPath = join(configDirectory, `${CONFIG_BASENAME}.jsonc`)
  if (existsSync(jsoncPath)) return { kind: "ready", path: jsoncPath }
  const jsonPath = join(configDirectory, `${CONFIG_BASENAME}.json`)
  return { kind: "ready", path: existsSync(jsonPath) ? jsonPath : jsoncPath }
}

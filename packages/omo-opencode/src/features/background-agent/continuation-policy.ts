import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"
import type { BackgroundTaskContinuationPolicy } from "./types"

export interface ContinuationSessionMetadata {
  readonly continuationPolicy: BackgroundTaskContinuationPolicy
}

const STORAGE_DIRECTORY_NAME = "background-agent-continuation-policy"

function getStoragePath(sessionID: string): string {
  return join(
    getOpenCodeStorageDir(),
    STORAGE_DIRECTORY_NAME,
    `${encodeURIComponent(sessionID)}.json`,
  )
}

function parseMetadata(raw: string): ContinuationSessionMetadata | undefined {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined

  const continuationPolicy = Reflect.get(parsed, "continuationPolicy")
  if (continuationPolicy !== "allow" && continuationPolicy !== "forbid") return undefined
  return { continuationPolicy }
}

export function setContinuationSessionMetadata(
  sessionID: string,
  metadata: ContinuationSessionMetadata,
): void {
  const storagePath = getStoragePath(sessionID)
  mkdirSync(dirname(storagePath), { recursive: true })
  writeFileSync(storagePath, JSON.stringify(metadata), "utf-8")
}

export function getContinuationSessionMetadata(
  sessionID: string,
): ContinuationSessionMetadata | undefined {
  const storagePath = getStoragePath(sessionID)
  if (!existsSync(storagePath)) return undefined

  try {
    return parseMetadata(readFileSync(storagePath, "utf-8"))
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

export function isContinuationForbidden(sessionID: string): boolean {
  return getContinuationSessionMetadata(sessionID)?.continuationPolicy === "forbid"
}

export function clearContinuationSessionMetadata(sessionID: string): void {
  const storagePath = getStoragePath(sessionID)
  if (existsSync(storagePath)) unlinkSync(storagePath)
}

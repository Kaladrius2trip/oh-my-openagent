import type { BackgroundTaskContinuationPolicy } from "./types"

export interface ContinuationSessionMetadata {
  readonly continuationPolicy: BackgroundTaskContinuationPolicy
}

const continuationSessionMetadata = new Map<string, ContinuationSessionMetadata>()

export function setContinuationSessionMetadata(
  sessionID: string,
  metadata: ContinuationSessionMetadata,
): void {
  continuationSessionMetadata.set(sessionID, { ...metadata })
}

export function getContinuationSessionMetadata(
  sessionID: string,
): ContinuationSessionMetadata | undefined {
  const metadata = continuationSessionMetadata.get(sessionID)
  return metadata ? { ...metadata } : undefined
}

export function clearContinuationSessionMetadataForTesting(): void {
  continuationSessionMetadata.clear()
}

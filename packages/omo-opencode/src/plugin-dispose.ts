import { log } from "./shared"

export type PluginDispose = () => Promise<void>

export function createPluginDispose(args: {
  backgroundManager: {
    shutdown: () => void | Promise<void>
  }
  moaManager?: {
    shutdown: () => void | Promise<void>
  }
  skillMcpManager: {
    disconnectAll: () => Promise<void>
  }
  disposeHooks: () => void
}): PluginDispose {
  const { backgroundManager, moaManager, skillMcpManager, disposeHooks } = args
  let disposePromise: Promise<void> | null = null

  return async (): Promise<void> => {
    if (disposePromise) {
      await disposePromise
      return
    }

    disposePromise = (async (): Promise<void> => {
      try {
        await moaManager?.shutdown()
      } catch (error) {
        log("[plugin-dispose] moaManager.shutdown() error:", error instanceof Error ? error : new Error(String(error)))
      }
      try {
        await backgroundManager.shutdown()
      } catch (error) {
        log("[plugin-dispose] backgroundManager.shutdown() error:", error instanceof Error ? error : new Error(String(error)))
      }
      try {
        await skillMcpManager.disconnectAll()
      } catch (error) {
        log("[plugin-dispose] skillMcpManager.disconnectAll() error:", error instanceof Error ? error : new Error(String(error)))
      }
      try {
        disposeHooks()
      } catch (error) {
        log("[plugin-dispose] disposeHooks() error:", error instanceof Error ? error : new Error(String(error)))
      }
    })()

    await disposePromise
  }
}

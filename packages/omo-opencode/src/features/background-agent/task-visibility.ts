import type { BackgroundTask } from "./types"

export function filterVisibleTasks<
  TTask extends Pick<BackgroundTask, "visibility">,
>(tasks: Iterable<TTask>): TTask[] {
  return Array.from(tasks).filter((task) => task.visibility !== "internal")
}

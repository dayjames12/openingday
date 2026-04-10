import type { WorkTree, WorkTask } from "../types.js";
import type { WorkerPool, WorkerSession } from "../workers/pool.js";
import { getActiveSessions } from "../workers/pool.js";
import { getAllTasks } from "../trees/work-tree.js";

/**
 * Find active workers whose lastActivityAt is older than the threshold.
 */
export function findStuckWorkers(
  pool: WorkerPool,
  stuckThresholdMinutes: number,
  now: Date = new Date(),
): WorkerSession[] {
  const thresholdMs = stuckThresholdMinutes * 60 * 1000;
  return getActiveSessions(pool).filter((s) => {
    const elapsed = now.getTime() - new Date(s.lastActivityAt).getTime();
    return elapsed > thresholdMs;
  });
}

/**
 * Find tasks with status "in_progress" that have no corresponding active session in the pool.
 */
export function findDeadTasks(workTree: WorkTree, pool: WorkerPool): WorkTask[] {
  const activeTaskIds = new Set(getActiveSessions(pool).map((s) => s.taskId));
  return getAllTasks(workTree).filter(
    (t) => t.status === "in_progress" && !activeTaskIds.has(t.id),
  );
}

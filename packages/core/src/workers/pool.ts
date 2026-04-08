import type { WorkTree, WorkTask, ProjectConfig, ProjectState, WorkerOutput } from "../types.js";
import { getReadyTasks, updateTaskStatus, updateTask } from "../trees/work-tree.js";
import { getActiveFileLocks } from "../trees/linker.js";

// === Worker Session ===

export interface WorkerSession {
  id: string;
  taskId: string;
  startedAt: string;
  status: "active" | "completed" | "failed" | "timed_out";
}

// === Worker Pool State ===

export interface WorkerPool {
  sessions: WorkerSession[];
  totalSpawned: number;
}

export function createWorkerPool(): WorkerPool {
  return { sessions: [], totalSpawned: 0 };
}

// === Pool Queries ===

export function getActiveSessions(pool: WorkerPool): WorkerSession[] {
  return pool.sessions.filter((s) => s.status === "active");
}

export function getSessionByTaskId(pool: WorkerPool, taskId: string): WorkerSession | null {
  return pool.sessions.find((s) => s.taskId === taskId && s.status === "active") ?? null;
}

export function getActiveCount(pool: WorkerPool): number {
  return getActiveSessions(pool).length;
}

// === Spawn Logic ===

export interface SpawnDecision {
  canSpawn: boolean;
  reason?: string;
  tasksToSpawn: WorkTask[];
}

/**
 * Determine which tasks can be spawned given current constraints.
 */
export function planSpawns(
  workTree: WorkTree,
  pool: WorkerPool,
  config: ProjectConfig,
  _state: ProjectState,
): SpawnDecision {
  const activeCount = getActiveCount(pool);
  const maxConcurrent = config.limits.maxConcurrentWorkers;
  const maxTotal = config.limits.maxTotalWorkers;

  if (pool.totalSpawned >= maxTotal) {
    return { canSpawn: false, reason: "Max total workers reached", tasksToSpawn: [] };
  }

  const slotsAvailable = maxConcurrent - activeCount;
  if (slotsAvailable <= 0) {
    return { canSpawn: false, reason: "All concurrent slots filled", tasksToSpawn: [] };
  }

  const fileLocks = getActiveFileLocks(workTree);
  const readyTasks = getReadyTasks(workTree, fileLocks);

  if (readyTasks.length === 0) {
    return { canSpawn: false, reason: "No ready tasks", tasksToSpawn: [] };
  }

  const remainingTotal = maxTotal - pool.totalSpawned;
  const spawnCount = Math.min(slotsAvailable, readyTasks.length, remainingTotal);
  const tasksToSpawn = readyTasks.slice(0, spawnCount);

  return { canSpawn: true, tasksToSpawn };
}

/**
 * Record a worker spawn in the pool.
 */
export function spawnWorker(
  pool: WorkerPool,
  sessionId: string,
  taskId: string,
): WorkerPool {
  const session: WorkerSession = {
    id: sessionId,
    taskId,
    startedAt: new Date().toISOString(),
    status: "active",
  };
  return {
    sessions: [...pool.sessions, session],
    totalSpawned: pool.totalSpawned + 1,
  };
}

/**
 * Mark a worker session as completed.
 */
export function completeWorker(
  pool: WorkerPool,
  sessionId: string,
  status: "completed" | "failed" | "timed_out",
): WorkerPool {
  return {
    ...pool,
    sessions: pool.sessions.map((s) =>
      s.id === sessionId ? { ...s, status } : s,
    ),
  };
}

/**
 * Apply worker output to the work tree: update task status and token spend.
 */
export function applyWorkerResult(
  workTree: WorkTree,
  taskId: string,
  output: WorkerOutput,
): WorkTree {
  const newStatus = output.status === "complete" ? "complete" as const : "failed" as const;
  let tree = updateTaskStatus(workTree, taskId, newStatus);
  tree = updateTask(tree, taskId, {
    tokenSpend: output.tokensUsed,
  });
  return tree;
}

/**
 * Find sessions that have exceeded the timeout.
 */
export function findTimedOutSessions(
  pool: WorkerPool,
  timeoutMinutes: number,
  now: Date = new Date(),
): WorkerSession[] {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  return getActiveSessions(pool).filter((s) => {
    const elapsed = now.getTime() - new Date(s.startedAt).getTime();
    return elapsed > timeoutMs;
  });
}

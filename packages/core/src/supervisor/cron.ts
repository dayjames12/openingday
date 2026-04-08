import type { Storage } from "../storage/interface.js";
import type { WorkerPool } from "../workers/pool.js";
import type { ProjectConfig } from "../types.js";
import { updateTaskStatus } from "../trees/work-tree.js";
import { getProjectBudgetStatus, checkCircuitBreakers } from "../budget/budget.js";
import { findStuckWorkers, findDeadTasks } from "./health.js";

// === Types ===

export interface SupervisorResult {
  stuckWorkersFound: number;
  deadTasksReset: number;
  budgetWarning: boolean;
  circuitTripped: boolean;
  projectPaused: boolean;
}

// === Supervisor Check ===

/**
 * Run a supervisor health check: find stuck workers, reset dead tasks,
 * check budget/circuit breakers, and log the result.
 */
export async function runSupervisorCheck(
  storage: Storage,
  pool: WorkerPool,
  config: ProjectConfig,
): Promise<SupervisorResult> {
  const state = await storage.readProjectState();
  let workTree = await storage.readWorkTree();

  // 1. Find stuck workers
  const stuckWorkers = findStuckWorkers(pool, config.limits.sessionTimeoutMin);

  // 2. Find dead tasks and reset them to pending
  const deadTasks = findDeadTasks(workTree, pool);
  for (const task of deadTasks) {
    workTree = updateTaskStatus(workTree, task.id, "pending");
  }

  if (deadTasks.length > 0) {
    await storage.writeWorkTree(workTree);
  }

  // 3. Check budget
  const budgetStatus = getProjectBudgetStatus(state, config);

  // 4. Check circuit breakers
  const circuitStatus = checkCircuitBreakers(workTree, state, config);

  const result: SupervisorResult = {
    stuckWorkersFound: stuckWorkers.length,
    deadTasksReset: deadTasks.length,
    budgetWarning: budgetStatus.atWarning,
    circuitTripped: circuitStatus.reason !== null,
    projectPaused: state.status === "paused",
  };

  // 5. Log the result
  await storage.writeSupervisorLog(JSON.stringify(result));

  return result;
}

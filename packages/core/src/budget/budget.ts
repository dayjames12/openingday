import type { ProjectConfig, ProjectState, WorkTree, WorkTask } from "../types.js";
import { getAllTasks } from "../trees/work-tree.js";

// === Budget Checks ===

export interface BudgetStatus {
  totalSpent: number;
  projectBudget: number;
  percentage: number;
  atWarning: boolean;
  atLimit: boolean;
}

/**
 * Calculate the overall project budget status.
 */
export function getProjectBudgetStatus(state: ProjectState, config: ProjectConfig): BudgetStatus {
  const totalSpent = state.totalTokenSpend;
  const projectBudget = config.budgets.project.usd * 1000; // convert to token-dollars (simplified)
  const percentage = projectBudget > 0 ? (totalSpent / projectBudget) * 100 : 0;

  return {
    totalSpent,
    projectBudget,
    percentage,
    atWarning: percentage >= config.budgets.project.warnPct,
    atLimit: percentage >= 100,
  };
}

/**
 * Check if a task is within its per-task budget.
 */
export function isTaskWithinBudget(task: WorkTask, config: ProjectConfig): boolean {
  const hardLimit = config.budgets.perTask.usd * 1000;
  return task.tokenSpend < hardLimit;
}

/**
 * Check if a task has hit its soft budget limit.
 */
export function isTaskAtSoftLimit(task: WorkTask, config: ProjectConfig): boolean {
  const hardLimit = config.budgets.perTask.usd * 1000;
  const softLimit = (hardLimit * config.budgets.perTask.softPct) / 100;
  return task.tokenSpend >= softLimit;
}

// === Circuit Breakers ===

export interface CircuitBreakerStatus {
  sliceTripped: boolean;
  projectTripped: boolean;
  efficiencyTripped: boolean;
  infraTripped: boolean;
  reason: string | null;
}

/**
 * Check all circuit breakers. Returns which ones have tripped.
 */
export function checkCircuitBreakers(
  workTree: WorkTree,
  state: ProjectState,
  config: ProjectConfig,
): CircuitBreakerStatus {
  const allTasks = getAllTasks(workTree);
  const sliceTripped = checkSliceBreaker(allTasks, config);
  const projectTripped = checkProjectBreaker(allTasks, config);
  const efficiencyTripped = checkEfficiencyBreaker(allTasks, state, config);
  const infraTripped = checkInfraBreaker(allTasks);

  let reason: string | null = null;
  if (infraTripped) {
    const infraTasks = allTasks.filter((t) => t.failureKind === "infra");
    const msg = infraTasks[0]?.failureMessage ?? "unknown";
    reason = `Infrastructure issue detected: ${msg}. Fix and resume.`;
  } else if (sliceTripped) {
    reason = "Too many consecutive failures in a slice";
  } else if (projectTripped) {
    reason = "Too many consecutive failures across project";
  } else if (efficiencyTripped) {
    reason = "Budget efficiency below threshold";
  }

  return { sliceTripped, projectTripped, efficiencyTripped, infraTripped, reason };
}

/**
 * Check consecutive failures within each slice.
 */
function checkSliceBreaker(allTasks: WorkTask[], config: ProjectConfig): boolean {
  const bySlice = new Map<string, WorkTask[]>();
  for (const task of allTasks) {
    const key = task.parentSliceId;
    if (!bySlice.has(key)) {
      bySlice.set(key, []);
    }
    bySlice.get(key)!.push(task);
  }

  for (const tasks of bySlice.values()) {
    const consecutiveFailures = countTrailingFailures(tasks);
    if (consecutiveFailures >= config.circuitBreakers.consecutiveFailuresSlice) {
      return true;
    }
  }
  return false;
}

/**
 * Check consecutive failures across the entire project.
 */
function checkProjectBreaker(allTasks: WorkTask[], config: ProjectConfig): boolean {
  const completedOrFailed = allTasks.filter(
    (t) => t.status === "complete" || t.status === "failed",
  );
  const consecutiveFailures = countTrailingFailures(completedOrFailed);
  return consecutiveFailures >= config.circuitBreakers.consecutiveFailuresProject;
}

/**
 * Check budget efficiency: ratio of completed tasks to total token spend.
 */
function checkEfficiencyBreaker(
  allTasks: WorkTask[],
  state: ProjectState,
  config: ProjectConfig,
): boolean {
  if (state.totalTokenSpend === 0) return false;

  const completedTasks = allTasks.filter((t) => t.status === "complete");
  const codeFailedTasks = allTasks.filter(
    (t) => t.status === "failed" && (t.failureKind === "code" || t.failureKind === undefined),
  );

  const total = completedTasks.length + codeFailedTasks.length;
  if (total === 0) return false;

  const efficiency = completedTasks.length / total;
  return efficiency < config.circuitBreakers.budgetEfficiencyThreshold;
}

function checkInfraBreaker(allTasks: WorkTask[]): boolean {
  const infraTasks = allTasks.filter((t) => t.status === "failed" && t.failureKind === "infra");
  if (infraTasks.length < 2) return false;

  const msgCounts = new Map<string, number>();
  for (const t of infraTasks) {
    const msg = t.failureMessage ?? "";
    msgCounts.set(msg, (msgCounts.get(msg) ?? 0) + 1);
  }
  return [...msgCounts.values()].some((count) => count >= 2);
}

/**
 * Count trailing consecutive failures in a task list.
 */
function countTrailingFailures(tasks: WorkTask[]): number {
  let count = 0;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i];
    if (task && task.status === "failed") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

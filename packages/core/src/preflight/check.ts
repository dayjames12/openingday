import type { WorkTree, CodeTree, ProjectConfig } from "../types.js";
import type { RepoMap } from "../scanner/types.js";
import { getTask, getAllTasks } from "../trees/work-tree.js";
import { getAllFiles } from "../trees/code-tree.js";
import { estimateTaskContext } from "../seeder/estimator.js";

// === Types ===

export interface PreflightResult {
  canProceed: boolean;
  warnings: string[];
  blockers: string[];
}

// === Main Check ===

/**
 * Run pre-flight checks before dispatching a task.
 * Returns blockers (prevent dispatch) and warnings (include in worker context).
 */
export function preflightCheck(
  workTree: WorkTree,
  codeTree: CodeTree,
  repoMap: RepoMap | null,
  config: ProjectConfig,
  taskId: string,
): PreflightResult {
  const warnings: string[] = [];
  const blockers: string[] = [];

  const task = getTask(workTree, taskId);
  if (!task) {
    blockers.push(`Task ${taskId} not found in work tree`);
    return { canProceed: false, warnings, blockers };
  }

  // 1. Task description specificity
  if (task.description.length < 20) {
    blockers.push(`Task description too short (${task.description.length} chars, need 20+)`);
  }
  if (!task.touches.some((t) => t.includes("/"))) {
    warnings.push("Task description may lack file path specificity");
  }

  // 2. All files in touches exist in code tree or repo map
  const codeFiles = new Set(getAllFiles(codeTree).map((f) => f.path));
  const repoFiles = new Set<string>();
  if (repoMap) {
    for (const mod of repoMap.modules) {
      for (const file of mod.files) {
        repoFiles.add(file.p);
      }
    }
  }
  for (const touchPath of task.touches) {
    if (!codeFiles.has(touchPath) && !repoFiles.has(touchPath)) {
      warnings.push(`Touch file "${touchPath}" not found in code tree or repo map`);
    }
  }

  // 3. Estimated context size under 150k tokens
  const estimate = estimateTaskContext(workTree, codeTree, taskId);
  if (estimate > 150_000) {
    blockers.push(`Estimated context ${estimate} tokens exceeds 150k limit`);
  } else if (estimate > 120_000) {
    warnings.push(`Estimated context ${estimate} tokens is close to 150k limit`);
  }

  // 4. Task budget sufficient (not already at attempt limit)
  if (task.attemptCount >= config.limits.maxRetries) {
    blockers.push(`Task has exhausted all ${config.limits.maxRetries} retry attempts`);
  }

  // 5. No circular dependencies in remaining tasks
  const circularDeps = detectCircularDeps(workTree, taskId);
  if (circularDeps) {
    blockers.push(`Circular dependency detected: ${circularDeps}`);
  }

  // 6. File conflicts with pending/in_progress tasks
  const allTasks = getAllTasks(workTree);
  const activeTasks = allTasks.filter(
    (t) => (t.status === "in_progress" || t.status === "pending") && t.id !== taskId,
  );
  for (const other of activeTasks) {
    if (other.status !== "in_progress") continue;
    const overlap = task.touches.filter((f) => other.touches.includes(f));
    if (overlap.length > 0) {
      warnings.push(
        `File conflict with in-progress task ${other.id}: ${overlap.join(", ")}`,
      );
    }
  }

  return {
    canProceed: blockers.length === 0,
    warnings,
    blockers,
  };
}

// === Helpers ===

/**
 * Detect circular dependencies starting from a task.
 * Returns a description of the cycle if found, null otherwise.
 */
function detectCircularDeps(workTree: WorkTree, startTaskId: string): string | null {
  const allTasks = getAllTasks(workTree);
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(taskId: string): string | null {
    if (path.includes(taskId)) {
      const cycleStart = path.indexOf(taskId);
      return [...path.slice(cycleStart), taskId].join(" -> ");
    }
    if (visited.has(taskId)) return null;

    const task = taskMap.get(taskId);
    if (!task) return null;

    path.push(taskId);
    for (const depId of task.dependencies) {
      const result = dfs(depId);
      if (result) return result;
    }
    path.pop();
    visited.add(taskId);
    return null;
  }

  return dfs(startTaskId);
}

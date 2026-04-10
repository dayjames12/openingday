import type { WorkTree, CodeTree } from "../types.js";
import type { RepoMap } from "../scanner/types.js";
import { getAllTasks } from "../trees/work-tree.js";
import { getAllFiles } from "../trees/code-tree.js";
import { estimateTaskContext } from "../seeder/estimator.js";

export interface ValidationResult {
  valid: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Structural validation of work tree + code tree before execution.
 * No AI calls — runs instantly.
 */
export function validateStructure(
  workTree: WorkTree,
  codeTree: CodeTree,
  repoMap?: RepoMap | null,
): ValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const allTasks = getAllTasks(workTree);
  const codeFiles = new Set(getAllFiles(codeTree).map((f) => f.path));
  const repoFiles = new Set<string>();
  const repoDirs = new Set<string>();
  if (repoMap) {
    for (const mod of repoMap.modules) {
      repoDirs.add(mod.p);
      for (const file of mod.files) {
        repoFiles.add(file.p);
        const dir = file.p.split("/").slice(0, -1).join("/");
        if (dir) repoDirs.add(dir);
      }
    }
  }

  // Check: every milestone has at least one task
  for (const m of workTree.milestones) {
    const taskCount = m.slices.reduce((n, s) => n + s.tasks.length, 0);
    if (taskCount === 0) {
      warnings.push(`Milestone "${m.id}" has no tasks`);
    }
  }

  // Build task dependency map
  const taskDeps = new Map<string, Set<string>>();
  for (const task of allTasks) {
    taskDeps.set(task.id, new Set(task.dependencies));
  }

  // Check: file existence (allow new files under existing ancestor dirs)
  for (const task of allTasks) {
    for (const touchPath of task.touches) {
      if (!codeFiles.has(touchPath) && !repoFiles.has(touchPath)) {
        if (repoMap) {
          const parts = touchPath.split("/");
          let ancestorFound = false;
          for (let i = parts.length - 1; i > 0; i--) {
            if (repoDirs.has(parts.slice(0, i).join("/"))) {
              ancestorFound = true;
              break;
            }
          }
          if (!ancestorFound) {
            blockers.push(
              `Task "${task.id}": touch file "${touchPath}" not found and no ancestor directory exists`,
            );
          }
        } else {
          blockers.push(
            `Task "${task.id}": touch file "${touchPath}" not found in code tree or repo map`,
          );
        }
      }
    }
    for (const readPath of task.reads) {
      if (!codeFiles.has(readPath) && !repoFiles.has(readPath)) {
        warnings.push(
          `Task "${task.id}": read file "${readPath}" not found in code tree or repo map`,
        );
      }
    }
  }

  // Check: one-owner-per-file (independent tasks must not share files)
  const fileTaskMap = new Map<string, string[]>();
  for (const task of allTasks) {
    for (const f of task.touches) {
      const existing = fileTaskMap.get(f) ?? [];
      existing.push(task.id);
      fileTaskMap.set(f, existing);
    }
  }

  for (const [file, taskIds] of fileTaskMap) {
    if (taskIds.length < 2) continue;
    for (let i = 0; i < taskIds.length; i++) {
      for (let j = i + 1; j < taskIds.length; j++) {
        const a = taskIds[i]!;
        const b = taskIds[j]!;
        // Check full transitive dependency chain
        if (!hasTransitiveDep(taskDeps, a, b) && !hasTransitiveDep(taskDeps, b, a)) {
          blockers.push(
            `one-owner violation: tasks "${a}" and "${b}" both touch "${file}" with no dependency chain`,
          );
        }
      }
    }
  }

  // Check: DAG (no cycles)
  const cycleResult = detectCycles(allTasks.map((t) => ({ id: t.id, deps: t.dependencies })));
  if (cycleResult) {
    blockers.push(`Dependency cycle detected: ${cycleResult}`);
  }

  // Check: context estimation < 150k
  for (const task of allTasks) {
    const estimate = estimateTaskContext(workTree, codeTree, task.id);
    if (estimate > 150_000) {
      blockers.push(`Task "${task.id}": estimated context ${estimate} tokens exceeds 150k limit`);
    } else if (estimate > 120_000) {
      warnings.push(`Task "${task.id}": estimated context ${estimate} tokens near 150k limit`);
    }
  }

  // Check: description quality (> 20 chars with file path)
  for (const task of allTasks) {
    if (task.description.length < 20) {
      warnings.push(
        `Task "${task.id}": description too short (${task.description.length} chars, need 20+)`,
      );
    }
  }

  // Check: tests-with-impl (implementation tasks should have test files)
  for (const task of allTasks) {
    const hasImplFile = task.touches.some(
      (f) => !f.includes(".test.") && !f.includes("__tests__") && !f.includes(".spec."),
    );
    const hasTestFile = task.touches.some(
      (f) => f.includes(".test.") || f.includes("__tests__") || f.includes(".spec."),
    );
    if (hasImplFile && !hasTestFile) {
      warnings.push(`Task "${task.id}": implementation task has no test files in touches`);
    }
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * Check if taskA transitively depends on taskB.
 */
function hasTransitiveDep(
  taskDeps: Map<string, Set<string>>,
  taskA: string,
  taskB: string,
): boolean {
  const visited = new Set<string>();
  const queue = [taskA];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = taskDeps.get(current);
    if (!deps) continue;
    if (deps.has(taskB)) return true;
    for (const dep of deps) {
      queue.push(dep);
    }
  }
  return false;
}

/**
 * Detect cycles in a dependency graph using DFS.
 */
function detectCycles(nodes: { id: string; deps: string[] }[]): string | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): string | null {
    if (path.includes(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId].join(" -> ");
    }
    if (visited.has(nodeId)) return null;

    const node = nodeMap.get(nodeId);
    if (!node) return null;

    path.push(nodeId);
    for (const depId of node.deps) {
      const result = dfs(depId);
      if (result) return result;
    }
    path.pop();
    visited.add(nodeId);
    return null;
  }

  for (const node of nodes) {
    const result = dfs(node.id);
    if (result) return result;
  }
  return null;
}

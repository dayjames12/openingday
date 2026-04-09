import type { WorkTree, CodeTree } from "../types.js";
import { getAllTasks } from "../trees/work-tree.js";
import { getAllFiles } from "../trees/code-tree.js";

export interface SimulationResult {
  executionOrder: string[];
  addedDependencies: string[][];
  warnings: string[];
}

/**
 * Simulate execution of the work tree to find missing dependencies and optimize order.
 * Walks tasks in dependency order, checking context sufficiency at each step.
 */
export function simulateExecution(
  workTree: WorkTree,
  codeTree: CodeTree,
): SimulationResult {
  const allTasks = getAllTasks(workTree);
  const codeFiles = new Set(getAllFiles(codeTree).map((f) => f.path));
  const warnings: string[] = [];
  const addedDependencies: string[][] = [];

  // Build maps
  const taskDeps = new Map(allTasks.map((t) => [t.id, new Set(t.dependencies)]));

  // Detect missing dependency links:
  // If task B reads a file that task A touches, and B doesn't depend on A
  const touchMap = new Map<string, string>();
  for (const task of allTasks) {
    for (const f of task.touches) {
      // First writer wins for detection purposes
      if (!touchMap.has(f)) {
        touchMap.set(f, task.id);
      }
    }
  }

  for (const task of allTasks) {
    for (const readFile of task.reads) {
      const writer = touchMap.get(readFile);
      if (writer && writer !== task.id) {
        const deps = taskDeps.get(task.id)!;
        if (!hasTransitiveDep(taskDeps, task.id, writer)) {
          addedDependencies.push([task.id, writer]);
          deps.add(writer);
          warnings.push(`Added dependency: "${task.id}" now depends on "${writer}" (reads "${readFile}")`);
        }
      }
    }

    // Check for reads that reference files not in code tree and not produced by any task
    for (const readFile of task.reads) {
      if (!codeFiles.has(readFile) && !touchMap.has(readFile)) {
        warnings.push(`Task "${task.id}" reads "${readFile}" which is not in code tree and not produced by any task`);
      }
    }
  }

  // Topological sort for execution order
  const executionOrder = topologicalSort(allTasks.map((t) => t.id), taskDeps);

  return {
    executionOrder,
    addedDependencies,
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
 * Topological sort using Kahn's algorithm.
 * Returns tasks in valid execution order.
 */
function topologicalSort(
  taskIds: string[],
  taskDeps: Map<string, Set<string>>,
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of taskIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const id of taskIds) {
    const deps = taskDeps.get(id);
    if (deps) {
      inDegree.set(id, deps.size);
      for (const dep of deps) {
        const adj = adjacency.get(dep);
        if (adj) adj.push(id);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Sort queue for deterministic output
    queue.sort();
    const current = queue.shift()!;
    sorted.push(current);
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

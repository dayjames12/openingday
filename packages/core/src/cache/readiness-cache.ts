import type { WorkTree, WorkTask } from "../types.js";

let cachedReady: { tasks: WorkTask[]; treeHash: string } | null = null;

function computeHash(workTree: WorkTree, fileLocks: string[]): string {
  // Include task statuses to detect tree mutations
  const taskStates = workTree.milestones.flatMap(m =>
    m.slices.flatMap(s => s.tasks.map(t => `${t.id}:${t.status}`)),
  );
  return JSON.stringify({ t: taskStates, locks: fileLocks });
}

export function getCachedReadyTasks(workTree: WorkTree, fileLocks: string[]): WorkTask[] | null {
  const hash = computeHash(workTree, fileLocks);
  if (cachedReady && cachedReady.treeHash === hash) return cachedReady.tasks;
  return null;
}

export function setCachedReadyTasks(tasks: WorkTask[], workTree: WorkTree, fileLocks: string[]): void {
  const hash = computeHash(workTree, fileLocks);
  cachedReady = { tasks, treeHash: hash };
}

export function invalidateReadinessCache(): void {
  cachedReady = null;
}

import type { WorkTree, WorkTask, CodeTree, CodeFile } from "../types.js";
import { getAllTasks, getTask } from "./work-tree.js";
import { getFile, getAllFiles } from "./code-tree.js";

/**
 * For a given task, resolve all code files it touches (writes to).
 */
export function resolveTaskTouches(
  workTree: WorkTree,
  codeTree: CodeTree,
  taskId: string,
): CodeFile[] {
  const task = getTask(workTree, taskId);
  if (!task) return [];
  return task.touches
    .map((path) => getFile(codeTree, path))
    .filter((f): f is CodeFile => f !== null);
}

/**
 * For a given task, resolve all code files it reads.
 */
export function resolveTaskReads(
  workTree: WorkTree,
  codeTree: CodeTree,
  taskId: string,
): CodeFile[] {
  const task = getTask(workTree, taskId);
  if (!task) return [];
  return task.reads.map((path) => getFile(codeTree, path)).filter((f): f is CodeFile => f !== null);
}

/**
 * Find all tasks that touch a given file.
 */
export function findTasksTouchingFile(workTree: WorkTree, filePath: string): WorkTask[] {
  return getAllTasks(workTree).filter((t) => t.touches.includes(filePath));
}

/**
 * Find all tasks that read a given file.
 */
export function findTasksReadingFile(workTree: WorkTree, filePath: string): WorkTask[] {
  return getAllTasks(workTree).filter((t) => t.reads.includes(filePath));
}

/**
 * Detect file conflicts: files that multiple incomplete tasks touch.
 * Returns a map of file path -> array of task IDs.
 */
export function detectFileConflicts(workTree: WorkTree): Map<string, string[]> {
  const fileToTasks = new Map<string, string[]>();
  const activeTasks = getAllTasks(workTree).filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );

  for (const task of activeTasks) {
    for (const path of task.touches) {
      const existing = fileToTasks.get(path) ?? [];
      existing.push(task.id);
      fileToTasks.set(path, existing);
    }
  }

  // Only return files with multiple tasks
  const conflicts = new Map<string, string[]>();
  for (const [path, taskIds] of fileToTasks) {
    if (taskIds.length > 1) {
      conflicts.set(path, taskIds);
    }
  }
  return conflicts;
}

/**
 * Get the set of files currently locked by in-progress tasks.
 */
export function getActiveFileLocks(workTree: WorkTree): string[] {
  const locks = new Set<string>();
  for (const task of getAllTasks(workTree)) {
    if (task.status === "in_progress") {
      for (const path of task.touches) {
        locks.add(path);
      }
    }
  }
  return Array.from(locks);
}

/**
 * Validate that all file paths referenced by tasks exist in the code tree.
 * Returns an array of { taskId, path, type } for missing references.
 */
export function validateFileReferences(
  workTree: WorkTree,
  codeTree: CodeTree,
): { taskId: string; path: string; type: "touches" | "reads" }[] {
  const allFilePaths = new Set(getAllFiles(codeTree).map((f) => f.path));
  const missing: { taskId: string; path: string; type: "touches" | "reads" }[] = [];

  for (const task of getAllTasks(workTree)) {
    for (const path of task.touches) {
      if (!allFilePaths.has(path)) {
        missing.push({ taskId: task.id, path, type: "touches" });
      }
    }
    for (const path of task.reads) {
      if (!allFilePaths.has(path)) {
        missing.push({ taskId: task.id, path, type: "reads" });
      }
    }
  }

  return missing;
}

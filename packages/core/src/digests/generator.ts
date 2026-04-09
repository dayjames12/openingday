// packages/core/src/digests/generator.ts
import type { TaskDigest, WorkerOutput, WorkTree, CodeTree } from "../types.js";
import { getTask } from "../trees/work-tree.js";
import { getFile } from "../trees/code-tree.js";

/**
 * Generate a wire-mode digest of what a completed task produced.
 * Stored and included in subsequent worker contexts.
 */
export function generateDigest(
  taskId: string,
  workerOutput: WorkerOutput,
  workTree: WorkTree,
  codeTree: CodeTree,
): TaskDigest {
  const task = getTask(workTree, taskId);

  // Collect exports from changed files
  const exports: string[] = [];
  for (const change of workerOutput.interfacesModified) {
    if (change.after) {
      exports.push(change.export);
    }
  }

  // Also check code tree for exports in touched files
  if (task) {
    for (const touchPath of task.touches) {
      const file = getFile(codeTree, touchPath);
      if (file) {
        for (const ex of file.exports) {
          if (!exports.includes(ex.name)) {
            exports.push(ex.name);
          }
        }
      }
    }
  }

  // Collect imports from code tree files
  const imports: string[] = [];
  if (task) {
    for (const touchPath of task.touches) {
      const file = getFile(codeTree, touchPath);
      if (file) {
        for (const im of file.imports) {
          imports.push(`${im.names.join(", ")} from ${im.from}`);
        }
      }
    }
  }

  // Build "did" summary from task description + worker notes
  const taskDesc = task?.description ?? "unknown task";
  const did = workerOutput.notes
    ? `${workerOutput.notes.slice(0, 150)}`
    : `completed: ${taskDesc.slice(0, 150)}`;

  // Infer pattern from files changed and exports
  const patterns: string[] = [];
  for (const file of workerOutput.filesChanged) {
    if (file.includes("route")) patterns.push("route handler");
    else if (file.includes("middleware")) patterns.push("middleware");
    else if (file.includes("component")) patterns.push("component");
    else if (file.includes("test")) patterns.push("test suite");
    else if (file.includes("store") || file.includes("db")) patterns.push("data layer");
    else if (file.includes("util")) patterns.push("utility");
  }
  const pattern = [...new Set(patterns)].join(", ") || "general implementation";

  return {
    task: taskId,
    did,
    ex: exports,
    im: imports,
    pattern,
  };
}

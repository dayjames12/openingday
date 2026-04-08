import type { WorkTree, CodeTree } from "../types.js";
import { buildContext } from "../context/context-builder.js";
import { toWirePrompt } from "../wire/wire.js";
import { defaultConfig } from "../config/defaults.js";
import { getAllTasks } from "../trees/work-tree.js";

// === Types ===

export interface OversizedTask {
  taskId: string;
  estimatedTokens: number;
  limit: number;
}

// === Token Estimation ===

/**
 * Estimate how many tokens a task's context package would use.
 * Builds the full context via buildContext(), converts to wire format,
 * and estimates tokens at ~4 characters per token.
 */
export function estimateTaskContext(
  workTree: WorkTree,
  codeTree: CodeTree,
  taskId: string,
): number {
  const config = defaultConfig("estimate", "spec.md");
  const ctx = buildContext(workTree, codeTree, config, taskId, "", "");
  if (!ctx) return 0;

  const wire = toWirePrompt(ctx);
  const json = JSON.stringify(wire);
  // Rough estimate: ~4 characters per token
  return Math.ceil(json.length / 4);
}

// === Oversized Task Detection ===

/**
 * Check all tasks in the work tree and return those whose estimated
 * context size exceeds the token limit.
 */
export function findOversizedTasks(
  workTree: WorkTree,
  codeTree: CodeTree,
  limitTokens?: number,
): OversizedTask[] {
  const limit = limitTokens ?? 150_000;
  const tasks = getAllTasks(workTree);
  const oversized: OversizedTask[] = [];

  for (const task of tasks) {
    const estimatedTokens = estimateTaskContext(workTree, codeTree, task.id);
    if (estimatedTokens > limit) {
      oversized.push({
        taskId: task.id,
        estimatedTokens,
        limit,
      });
    }
  }

  return oversized;
}

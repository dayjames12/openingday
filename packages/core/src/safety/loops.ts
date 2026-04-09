// packages/core/src/safety/loops.ts
import type { LoopTracker, StageType, StageFeedback } from "../types.js";

const MAX_PER_STAGE = 5;
const MAX_SAME_ERROR = 3;
const MAX_TOTAL_LOOPS = 15;
const MAX_IDENTICAL_DIFFS = 2;
const MAX_LOOP_IDS = 50;

export interface BreakDecision {
  break: boolean;
  reason: string;
}

/**
 * Create a new loop tracker for a task.
 */
export function createLoopTracker(taskId: string): LoopTracker {
  return {
    taskId,
    stageLoopIds: [],
    totalLoops: 0,
  };
}

/**
 * Record a loop iteration. Returns updated tracker (immutable).
 */
export function recordLoop(tracker: LoopTracker, stage: StageType): LoopTracker {
  const loopId = `${stage}-${tracker.totalLoops + 1}-${Date.now()}`;
  return {
    ...tracker,
    stageLoopIds: [...tracker.stageLoopIds, loopId],
    totalLoops: tracker.totalLoops + 1,
  };
}

/**
 * Determine if the loop should break based on safety caps.
 *
 * @param tracker - Current loop tracker state
 * @param stage - Current stage being looped
 * @param errorHistory - All feedback objects from this stage's loops
 * @param diffHistory - Diffs produced in each loop iteration
 */
export function shouldBreak(
  tracker: LoopTracker,
  stage: StageType,
  errorHistory: StageFeedback[],
  diffHistory: string[],
): BreakDecision {
  // Check: max loop IDs (hard kill)
  if (tracker.stageLoopIds.length >= MAX_LOOP_IDS) {
    return { break: true, reason: `Hard kill: ${MAX_LOOP_IDS} loop IDs created` };
  }

  // Check: max total loops across all stages
  if (tracker.totalLoops >= MAX_TOTAL_LOOPS) {
    return { break: true, reason: `Total loops (${tracker.totalLoops}) reached max ${MAX_TOTAL_LOOPS}` };
  }

  // Check: max per stage
  const stageLoops = tracker.stageLoopIds.filter((id) => id.startsWith(stage)).length;
  if (stageLoops >= MAX_PER_STAGE) {
    return { break: true, reason: `Stage "${stage}" reached max ${MAX_PER_STAGE} loops` };
  }

  // Check: same error consecutive
  if (errorHistory.length >= MAX_SAME_ERROR) {
    const recent = errorHistory.slice(-MAX_SAME_ERROR);
    const firstErrors = JSON.stringify(recent[0]?.errors ?? []);
    const allSame = recent.every((fb) => JSON.stringify(fb.errors) === firstErrors);
    if (allSame) {
      return { break: true, reason: `Same error repeated ${MAX_SAME_ERROR} times in "${stage}"` };
    }
  }

  // Check: identical diff
  if (diffHistory.length >= MAX_IDENTICAL_DIFFS) {
    const recent = diffHistory.slice(-MAX_IDENTICAL_DIFFS);
    if (recent.length === MAX_IDENTICAL_DIFFS && recent.every((d) => d === recent[0])) {
      return { break: true, reason: `Identical diff produced ${MAX_IDENTICAL_DIFFS} times — worker is stuck` };
    }
  }

  return { break: false, reason: "" };
}

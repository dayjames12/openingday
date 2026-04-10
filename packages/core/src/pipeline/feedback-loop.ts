import type { SpawnFn, StageResult, StageType, StageFeedback, EnrichedContextPackage } from "../types.js";
import { createLoopTracker, recordLoop, shouldBreak } from "../safety/loops.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface FeedbackLoopOptions {
  stage: StageType;
  runStage: () => Promise<StageResult>;
  spawn: SpawnFn;
  taskId: string;
  worktreePath: string;
  context: EnrichedContextPackage;
  taskBudget: number;
  maxIterations: number;
}

export interface FeedbackLoopResult {
  passed: boolean;
  iterations: number;
  finalFeedback: StageFeedback[];
  stuckDetected: boolean;
  stageResult: StageResult;
}

export async function runFeedbackLoop(options: FeedbackLoopOptions): Promise<FeedbackLoopResult> {
  const { stage, runStage, spawn, taskId, worktreePath, context, taskBudget, maxIterations } = options;

  let tracker = createLoopTracker(taskId);
  const errorHistory: StageFeedback[] = [];
  const diffHistory: string[] = [];
  let iterations = 0;

  // Initial run
  let stageResult = await runStage();

  if (stageResult.passed) {
    return {
      passed: true,
      iterations: 0,
      finalFeedback: [],
      stuckDetected: false,
      stageResult,
    };
  }

  // Feedback loop
  for (let i = 0; i < maxIterations; i++) {
    // Record loop
    tracker = recordLoop(tracker, stage);
    iterations++;

    // Collect feedback
    for (const fb of stageResult.feedback) {
      errorHistory.push(fb);
    }

    // Check safety caps
    const breakCheck = shouldBreak(tracker, stage, errorHistory, diffHistory);
    if (breakCheck.break) {
      const stuckDetected = breakCheck.reason.includes("Same error") || breakCheck.reason.includes("Identical diff");
      stageResult.loops = iterations;
      return {
        passed: false,
        iterations,
        finalFeedback: errorHistory,
        stuckDetected,
        stageResult,
      };
    }

    // Respawn worker with feedback appended to context memory
    const feedbackJson = JSON.stringify(stageResult.feedback);
    const feedbackContext: EnrichedContextPackage = {
      ...context,
      memory: context.memory + `\n${stage.toUpperCase()} FEEDBACK (loop ${iterations}):\n${feedbackJson}`,
    };

    await spawn({
      taskId,
      worktreePath,
      context: feedbackContext,
      budgetUsd: taskBudget / 4,
    });

    // Capture git diff for stuck detection
    try {
      const { stdout } = await exec("git", ["diff"], { cwd: worktreePath });
      diffHistory.push(stdout);
    } catch {
      diffHistory.push("");
    }

    // Re-run stage
    stageResult = await runStage();

    if (stageResult.passed) {
      stageResult.loops = iterations;
      return {
        passed: true,
        iterations,
        finalFeedback: errorHistory,
        stuckDetected: false,
        stageResult,
      };
    }
  }

  // Max iterations exhausted
  stageResult.loops = iterations;
  return {
    passed: false,
    iterations,
    finalFeedback: errorHistory,
    stuckDetected: false,
    stageResult,
  };
}

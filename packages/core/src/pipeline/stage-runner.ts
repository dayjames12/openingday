import type {
  SpawnFn,
  EnrichedContextPackage,
  WorkerOutput,
  StageResult,
  StageFeedback,
} from "../types.js";
import type { EnvConfig } from "../scanner/types.js";
import type { SpawnResult } from "../workers/spawner.js";
import { inspectWorktreeOutput } from "../workers/inspect.js";
import { runCompileStage } from "../stages/compile.js";
import { runTestStage } from "../stages/test.js";
import { runReviewStage } from "../stages/review.js";
import { runFeedbackLoop } from "./feedback-loop.js";
import { recordLoop, createLoopTracker, shouldBreak } from "../safety/loops.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const exec = promisify(execFile);

// === Interfaces ===

export interface StageOutcome {
  stage: "implement" | "compile" | "test" | "review" | "gate";
  passed: boolean;
  feedback?: StageFeedback[];
  loopCount?: number;
}

export interface PipelineOptions {
  taskId: string;
  taskTouches: string[];
  worktreePath: string;
  worktreeBranch: string | null;
  context: EnrichedContextPackage;
  taskBudget: number;
  env: EnvConfig | null;
  repoDir: string | null;
  spawn: SpawnFn;
  contracts: string;
  specExcerpt: string;
}

export interface PipelineResult {
  workerOutput: WorkerOutput;
  spawnResult: SpawnResult;
  stages: StageOutcome[];
  allPassed: boolean;
  stageResults: StageResult[];
}

// === Pipeline ===

export async function runStagedPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    taskId,
    taskTouches,
    worktreePath,
    context,
    taskBudget,
    env,
    repoDir,
    spawn,
    contracts,
    specExcerpt,
  } = options;

  const stages: StageOutcome[] = [];
  const stageResults: StageResult[] = [];

  // === IMPLEMENT ===
  const spawnResult = await spawn({
    taskId,
    worktreePath,
    context,
    budgetUsd: taskBudget,
  });

  let workerOutput = spawnResult.output;
  if (spawnResult.needsInspection) {
    workerOutput = await inspectWorktreeOutput(worktreePath, taskTouches, env);
  }

  const implementPassed = workerOutput.status !== "failed";
  stages.push({ stage: "implement", passed: implementPassed });

  if (!implementPassed) {
    return { workerOutput, spawnResult, stages, allPassed: false, stageResults };
  }

  // Skip compile/test/review when not in a real worktree or no env detected
  if (worktreePath === "." || !env) {
    return { workerOutput, spawnResult, stages, allPassed: true, stageResults };
  }

  // Ensure worktree has node_modules (symlink from main repo)
  if (repoDir) {
    try {
      const { stdout: lsOut } = await exec("ls", ["-d", join(worktreePath, "node_modules")]).catch(
        () => ({ stdout: "" }),
      );
      if (!lsOut.trim()) {
        await exec("ln", ["-s", join(repoDir, "node_modules"), join(worktreePath, "node_modules")]);
      }
    } catch {
      /* non-fatal */
    }
  }

  let allPassed = true;

  // === COMPILE ===
  if (env?.ts) {
    const compileLoop = await runFeedbackLoop({
      stage: "compile",
      runStage: () => runCompileStage(worktreePath, taskBudget),
      spawn,
      taskId,
      worktreePath,
      context,
      taskBudget,
      maxIterations: 5,
    });
    stageResults.push(compileLoop.stageResult);
    stages.push({
      stage: "compile",
      passed: compileLoop.passed,
      feedback: compileLoop.finalFeedback,
      loopCount: compileLoop.iterations,
    });
    if (!compileLoop.passed) {
      return { workerOutput, spawnResult, stages, allPassed: false, stageResults };
    }
  }

  // === TEST ===
  if (env) {
    const testLoop = await runFeedbackLoop({
      stage: "test",
      runStage: () => runTestStage(worktreePath, env, taskTouches, taskBudget),
      spawn,
      taskId,
      worktreePath,
      context,
      taskBudget,
      maxIterations: 5,
    });
    stageResults.push(testLoop.stageResult);
    stages.push({
      stage: "test",
      passed: testLoop.passed,
      feedback: testLoop.finalFeedback,
      loopCount: testLoop.iterations,
    });
    if (!testLoop.passed) {
      return { workerOutput, spawnResult, stages, allPassed: false, stageResults };
    }
  }

  // === REVIEW ===
  let diff = "";
  try {
    const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
    diff = stdout;
  } catch {
    diff = "(could not generate diff)";
  }

  let reviewResult = await runReviewStage(worktreePath, diff, contracts, specExcerpt, taskBudget);
  stageResults.push(reviewResult);

  if (!reviewResult.passed) {
    // Give worker one chance to fix review issues
    const tracker = recordLoop(createLoopTracker(taskId), "review");
    const breakCheck = shouldBreak(tracker, "review", reviewResult.feedback, []);

    if (breakCheck.break) {
      stages.push({
        stage: "review",
        passed: false,
        feedback: reviewResult.feedback,
        loopCount: 1,
      });
      return { workerOutput, spawnResult, stages, allPassed: false, stageResults };
    }

    // Re-spawn with review feedback
    const feedbackContext: EnrichedContextPackage = {
      ...context,
      memory: context.memory + `\nREVIEW FEEDBACK:\n${JSON.stringify(reviewResult.feedback)}`,
    };
    await spawn({
      taskId,
      worktreePath,
      context: feedbackContext,
      budgetUsd: taskBudget / 4,
    });

    // Re-capture diff after worker fix attempt
    try {
      const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
      diff = stdout;
    } catch {
      diff = "(could not generate diff)";
    }

    // Re-run review with fresh diff
    reviewResult = await runReviewStage(worktreePath, diff, contracts, specExcerpt, taskBudget);
    stageResults.push(reviewResult);

    if (!reviewResult.passed) {
      allPassed = false;
    }
  }

  stages.push({
    stage: "review",
    passed: reviewResult.passed,
    feedback: reviewResult.feedback,
    loopCount: reviewResult.passed ? 0 : 1,
  });

  return { workerOutput, spawnResult, stages, allPassed, stageResults };
}

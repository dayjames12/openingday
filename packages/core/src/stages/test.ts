// packages/core/src/stages/test.ts
import { execFile } from "node:child_process";
import type { StageResult, StageFeedback } from "../types.js";
import type { EnvConfig } from "../scanner/types.js";
import { digestTestFailures } from "./feedback.js";

export interface TestRunResult {
  exitCode: number;
  output: string;
}

/**
 * Run the test command for the detected package manager.
 */
export function runTests(worktreePath: string, env: EnvConfig): Promise<TestRunResult> {
  const cmd = env.pm;
  const args = ["test"];

  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: worktreePath, timeout: 300_000 },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as Error & { code?: number; stdout?: string; stderr?: string };
          resolve({
            exitCode: typeof err.code === "number" ? err.code : 1,
            output: (err.stdout ?? stdout ?? "") + (err.stderr ?? stderr ?? ""),
          });
        } else {
          resolve({ exitCode: 0, output: (stdout ?? "") + (stderr ?? "") });
        }
      },
    );
  });
}

/**
 * Detect "no tests found" in test runner output.
 */
function isNoTestsFound(output: string): boolean {
  const patterns = [
    "no test files found",
    "no tests found",
    "no test suites found",
    "No test files found",
    "No tests found",
  ];
  return patterns.some((p) => output.toLowerCase().includes(p.toLowerCase()));
}

/**
 * Run the test stage for a task worktree.
 * Executes the project's test runner. On failure, calls AI to digest failures.
 * Detects "no tests found" as a special case.
 * Does NOT loop internally — the caller (orchestrator) handles the loop.
 */
export async function runTestStage(
  worktreePath: string,
  env: EnvConfig,
  taskTouches: string[],
  taskBudget: number,
): Promise<StageResult> {
  const testResult = await runTests(worktreePath, env);

  if (testResult.exitCode === 0) {
    // Check for "no tests found" even on exit 0 (some runners don't fail)
    if (isNoTestsFound(testResult.output)) {
      const implFiles = taskTouches.filter((f) => !f.includes(".test.") && !f.includes("__tests__") && !f.includes(".spec."));
      return {
        stage: "test",
        passed: false,
        loops: 0,
        feedback: [{
          stage: "test",
          errors: implFiles.map((f) => ({
            f,
            l: 0,
            e: "No tests found for this file",
            fix: `Write tests for ${f} — cover main exports and edge cases`,
          })),
        }],
      };
    }
    return {
      stage: "test",
      passed: true,
      loops: 0,
      feedback: [],
    };
  }

  // Check for "no tests found" on failure too
  if (isNoTestsFound(testResult.output)) {
    const implFiles = taskTouches.filter((f) => !f.includes(".test.") && !f.includes("__tests__") && !f.includes(".spec."));
    return {
      stage: "test",
      passed: false,
      loops: 0,
      feedback: [{
        stage: "test",
        errors: implFiles.map((f) => ({
          f,
          l: 0,
          e: "No tests found for this file",
          fix: `Write tests for ${f} — cover main exports and edge cases`,
        })),
      }],
    };
  }

  // Digest failures via AI
  let feedback: StageFeedback;
  try {
    feedback = await digestTestFailures(testResult.output, worktreePath, taskBudget / 4);
  } catch {
    feedback = {
      stage: "test",
      errors: [{ f: "unknown", l: 0, e: testResult.output.slice(0, 500), fix: "Fix failing tests" }],
    };
  }

  return {
    stage: "test",
    passed: false,
    loops: 0,
    feedback: [feedback],
  };
}

// packages/core/src/stages/compile.ts
import { execFile } from "node:child_process";
import type { StageResult, StageFeedback } from "../types.js";
import { digestCompileErrors } from "./feedback.js";

export interface TscResult {
  exitCode: number;
  output: string;
}

/**
 * Run `tsc --noEmit` in a worktree directory.
 * Returns raw exit code and output for further processing.
 */
export function runTsc(worktreePath: string): Promise<TscResult> {
  return new Promise((resolve) => {
    execFile(
      "npx",
      ["tsc", "--noEmit"],
      { cwd: worktreePath, timeout: 120_000 },
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
 * Run the compile stage for a task worktree.
 * Executes tsc --noEmit. On failure, calls AI to digest errors into structured feedback.
 * Does NOT loop internally — the caller (orchestrator) handles the loop.
 */
export async function runCompileStage(
  worktreePath: string,
  taskBudget: number,
): Promise<StageResult> {
  const tscResult = await runTsc(worktreePath);

  if (tscResult.exitCode === 0) {
    return {
      stage: "compile",
      passed: true,
      loops: 0,
      feedback: [],
    };
  }

  // Digest errors via AI
  let feedback: StageFeedback;
  try {
    feedback = await digestCompileErrors(tscResult.output, worktreePath, taskBudget / 4);
  } catch {
    // If AI digest fails, create a raw feedback entry
    feedback = {
      stage: "compile",
      errors: [
        {
          f: "unknown",
          l: 0,
          e: tscResult.output.slice(0, 500),
          fix: "Fix TypeScript compilation errors",
        },
      ],
    };
  }

  return {
    stage: "compile",
    passed: false,
    loops: 0,
    feedback: [feedback],
  };
}

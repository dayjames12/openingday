import type { StageResult } from "../types.js";

export interface FailureClassification {
  stage: string;
  kind: "infra" | "code" | "budget" | "timeout";
  message: string;
}

const INFRA_PATTERNS = [
  /Cannot find module/,
  /ENOENT/,
  /symlink/i,
  /Permission denied/,
  /must have setting "composite": true/,
  /['"]?--jsx['"]? is not set/,
  /not found in code tree/,
  /TypeScript declaration file not generated/,
];

/**
 * Classify a pipeline failure as infra, code, budget, or timeout.
 *
 * Infra failures (worktree setup, missing node_modules, tsconfig issues) should
 * not count against the circuit breaker — only code failures should.
 */
export function classifyFailure(
  stageResults: StageResult[],
  spawnError?: string,
): FailureClassification {
  if (stageResults.length === 0) {
    if (spawnError) {
      if (/rate_limit|429/.test(spawnError)) {
        return { stage: "spawn", kind: "timeout", message: spawnError };
      }
      if (/budget/.test(spawnError)) {
        return { stage: "spawn", kind: "budget", message: spawnError };
      }
    }
    return {
      stage: "spawn",
      kind: "timeout",
      message: spawnError ?? "No stage results — worker did not start or timed out",
    };
  }

  const failedStage = stageResults.find((r) => !r.passed);
  if (!failedStage) {
    // All stages passed — shouldn't happen in failure path, but be safe
    return { stage: "unknown", kind: "code", message: "No failed stage found" };
  }

  const firstError = failedStage.feedback[0]?.errors[0];
  if (firstError) {
    for (const pattern of INFRA_PATTERNS) {
      if (pattern.test(firstError.e)) {
        return {
          stage: failedStage.stage,
          kind: "infra",
          message: firstError.e,
        };
      }
    }
  }

  return {
    stage: failedStage.stage,
    kind: "code",
    message: firstError?.e ?? "Stage failed with no error details",
  };
}

import type {
  GateResult,
  GateIssue,
  GateSeverity,
  WorkerOutput,
  WorkTree,
  CodeTree,
} from "../types.js";
import { createQualityGateCheck } from "./quality.js";
import { realTestGate, realDiffGate, realSecurityGate } from "./verification.js";
import { validateContracts } from "./contracts-gate.js";
import type { EnvConfig } from "../scanner/types.js";

// === Gate Layer Definition ===

export type GateLayer =
  | "automated"
  | "security"
  | "quality"
  | "tree-check"
  | "verification"
  | "human";

export interface GateCheck {
  layer: GateLayer;
  run: (output: WorkerOutput, workTree: WorkTree, codeTree: CodeTree) => GateResult;
}

export interface VerificationGateCheck {
  layer: GateLayer;
  run: (
    output: WorkerOutput,
    workTree: WorkTree,
    codeTree: CodeTree,
    worktreePath: string,
  ) => Promise<GateResult>;
}

export type AnyGateCheck = GateCheck | VerificationGateCheck;

function isVerificationGate(check: AnyGateCheck): check is VerificationGateCheck {
  // Verification gates have async run that takes 4 args
  return check.run.length === 4;
}

// === Pipeline ===

/**
 * Run all gate checks in order. Returns results array and an overall pass/fail.
 * Supports both sync GateCheck and async VerificationGateCheck.
 */
export async function runGatePipeline(
  checks: AnyGateCheck[],
  output: WorkerOutput,
  workTree: WorkTree,
  codeTree: CodeTree,
  worktreePath?: string,
): Promise<{ results: GateResult[]; passed: boolean }> {
  const results: GateResult[] = [];
  let passed = true;

  for (const check of checks) {
    let result: GateResult;
    if (isVerificationGate(check) && worktreePath) {
      result = await check.run(output, workTree, codeTree, worktreePath);
    } else if (!isVerificationGate(check)) {
      result = check.run(output, workTree, codeTree);
    } else {
      // Skip verification gate if no worktreePath
      continue;
    }
    results.push(result);
    if (!result.pass) {
      passed = false;
    }
  }

  return { results, passed };
}

// === Built-in Gate Checks ===

/**
 * Automated gate: checks that tests pass (no failures).
 */
export function automatedTestGate(): GateCheck {
  return {
    layer: "automated",
    run(output) {
      const issues: GateIssue[] = [];
      if (output.testResults.fail > 0) {
        issues.push({
          severity: "high",
          rule: "tests-must-pass",
          file: "",
          note: `${output.testResults.fail} test(s) failed`,
        });
      }
      return {
        layer: "automated",
        pass: issues.length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Tree-check gate: verifies all changed files were declared in the task's touches.
 */
export function treeCheckGate(taskTouches: string[]): GateCheck {
  return {
    layer: "tree-check",
    run(output) {
      const touchSet = new Set(taskTouches);
      const issues: GateIssue[] = [];

      for (const file of output.filesChanged) {
        if (!touchSet.has(file)) {
          issues.push({
            severity: "high",
            rule: "undeclared-file-change",
            file,
            note: `File "${file}" was changed but not declared in task touches`,
          });
        }
      }

      return {
        layer: "tree-check",
        pass: issues.length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Security gate: basic check for known dangerous patterns.
 */
export function securityGate(
  dangerousPatterns: string[] = ["eval(", "exec(", "child_process"],
): GateCheck {
  return {
    layer: "security",
    run(output) {
      const issues: GateIssue[] = [];
      // Check notes for dangerous patterns (simplified — in production we'd check actual file contents)
      for (const pattern of dangerousPatterns) {
        if (output.notes.includes(pattern)) {
          issues.push({
            severity: "high",
            rule: "dangerous-pattern",
            file: "",
            note: `Output notes contain dangerous pattern: "${pattern}"`,
          });
        }
      }
      return {
        layer: "security",
        pass: issues.length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// === Result Queries ===

/**
 * Check if all gate results pass.
 */
export function allGatesPassed(results: GateResult[]): boolean {
  return results.every((r) => r.pass);
}

/**
 * Get all high-severity issues from gate results.
 */
export function getHighSeverityIssues(results: GateResult[]): GateIssue[] {
  return results.flatMap((r) => r.issues.filter((i) => i.severity === "high"));
}

/**
 * Count issues by severity.
 */
export function countIssuesBySeverity(results: GateResult[]): Record<GateSeverity, number> {
  const counts: Record<GateSeverity, number> = { high: 0, low: 0 };
  for (const result of results) {
    for (const issue of result.issues) {
      counts[issue.severity]++;
    }
  }
  return counts;
}

/**
 * Create a default pipeline with built-in checks.
 * When worktreePath is provided, adds real verification gates.
 */
export function createDefaultPipeline(
  taskTouches: string[],
  standards?: string,
  opts?: { worktreePath?: string; env?: EnvConfig; contracts?: string },
): AnyGateCheck[] {
  const pipeline: AnyGateCheck[] = [
    automatedTestGate(),
    treeCheckGate(taskTouches),
    securityGate(),
  ];
  if (opts?.contracts) {
    pipeline.push({
      layer: "automated" as const,
      run(): GateResult {
        return validateContracts(opts.contracts!, taskTouches);
      },
    });
  }
  if (standards) {
    pipeline.push(createQualityGateCheck(standards));
  }
  if (opts?.worktreePath) {
    if (opts.env) {
      pipeline.push(realTestGate(opts.env));
    }
    pipeline.push(realDiffGate(taskTouches));
    pipeline.push(realSecurityGate());
  }
  return pipeline;
}

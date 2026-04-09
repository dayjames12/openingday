import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GateResult, GateIssue, WorkerOutput, WorkTree, CodeTree } from "../types.js";
import type { EnvConfig } from "../scanner/types.js";
import type { VerificationGateCheck } from "./pipeline.js";

const exec = promisify(execFile);

// Dangerous patterns to scan for in changed files
const DANGEROUS_PATTERNS = [
  { pattern: /\beval\s*\(/, rule: "no-eval", note: "eval() is a code injection risk" },
  { pattern: /\bexec\s*\(/, rule: "no-exec", note: "exec() can run arbitrary commands" },
  { pattern: /child_process/, rule: "no-child-process", note: "child_process import is a security risk" },
  { pattern: /\bFunction\s*\(/, rule: "no-function-constructor", note: "Function() constructor is equivalent to eval" },
  { pattern: /process\.env\b/, rule: "env-access", note: "Direct process.env access — prefer config injection" },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/, rule: "no-private-keys", note: "Private key detected in source" },
  { pattern: /(?:password|secret|token)\s*[:=]\s*["'][^"']{8,}/, rule: "no-hardcoded-secrets", note: "Possible hardcoded secret" },
];

/**
 * Verification gate: actually runs tests in the worktree.
 * Compares real test output with worker-reported test results.
 */
export function realTestGate(env: EnvConfig): VerificationGateCheck {
  return {
    layer: "verification",
    async run(output, _workTree, _codeTree, worktreePath) {
      const issues: GateIssue[] = [];

      // Determine test command
      const testCmd = env.test;
      if (testCmd === "none") {
        return {
          layer: "verification",
          pass: true,
          issues: [],
          timestamp: new Date().toISOString(),
        };
      }

      const pm = env.pm;
      try {
        const { stdout, stderr } = await exec(pm, ["test"], {
          cwd: worktreePath,
          timeout: 120_000, // 2 minute timeout
          env: { ...process.env, CI: "true", NODE_ENV: "test" },
        });

        // Parse test output for pass/fail counts
        const combined = stdout + stderr;
        const failMatch = combined.match(/(\d+)\s+(?:failed|failing)/i);
        const passMatch = combined.match(/(\d+)\s+(?:passed|passing)/i);

        const realFail = failMatch ? parseInt(failMatch[1]!, 10) : 0;
        const realPass = passMatch ? parseInt(passMatch[1]!, 10) : 0;

        // Compare with worker-reported results
        if (realFail > 0 && output.testResults.fail === 0) {
          issues.push({
            severity: "high",
            rule: "test-results-mismatch",
            file: "",
            note: `Worker reported 0 failures but real tests found ${realFail} failure(s)`,
          });
        }

        if (realFail > 0) {
          issues.push({
            severity: "high",
            rule: "real-tests-failing",
            file: "",
            note: `Real test run: ${realPass} passed, ${realFail} failed`,
          });
        }
      } catch (err: unknown) {
        const error = err as { code?: number; stderr?: string; killed?: boolean };
        if (error.killed) {
          issues.push({
            severity: "high",
            rule: "test-timeout",
            file: "",
            note: "Test execution timed out after 120s",
          });
        } else {
          // Non-zero exit code usually means test failures
          issues.push({
            severity: "high",
            rule: "real-tests-failing",
            file: "",
            note: `Test command exited with error: ${(error.stderr ?? "unknown").slice(0, 300)}`,
          });
        }
      }

      return {
        layer: "verification",
        pass: issues.filter((i) => i.severity === "high").length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Verification gate: runs git diff in the worktree and compares
 * with worker-reported filesChanged. Fails if undeclared files are found.
 */
export function realDiffGate(taskTouches: string[]): VerificationGateCheck {
  return {
    layer: "verification",
    async run(output, _workTree, _codeTree, worktreePath) {
      const issues: GateIssue[] = [];
      const touchSet = new Set(taskTouches);

      try {
        const { stdout } = await exec("git", ["diff", "--name-only", "HEAD"], {
          cwd: worktreePath,
        });

        const realChanged = stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        // Check for undeclared file changes
        for (const file of realChanged) {
          if (!touchSet.has(file)) {
            issues.push({
              severity: "high",
              rule: "undeclared-real-file-change",
              file,
              note: `File "${file}" was changed in worktree but not declared in task touches`,
            });
          }
        }

        // Check for files worker claimed to change but didn't
        const realSet = new Set(realChanged);
        for (const claimed of output.filesChanged) {
          if (!realSet.has(claimed)) {
            issues.push({
              severity: "low",
              rule: "phantom-file-change",
              file: claimed,
              note: `Worker reported changing "${claimed}" but git diff shows no changes`,
            });
          }
        }
      } catch {
        // git diff failed — might be a fresh repo with no commits
        issues.push({
          severity: "low",
          rule: "diff-check-error",
          file: "",
          note: "Could not run git diff in worktree",
        });
      }

      return {
        layer: "verification",
        pass: issues.filter((i) => i.severity === "high").length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Verification gate: reads actual changed file contents and scans
 * for dangerous patterns.
 */
export function realSecurityGate(): VerificationGateCheck {
  return {
    layer: "verification",
    async run(output, _workTree, _codeTree, worktreePath) {
      const issues: GateIssue[] = [];

      for (const filePath of output.filesChanged) {
        try {
          const fullPath = join(worktreePath, filePath);
          const content = await readFile(fullPath, "utf-8");

          for (const { pattern, rule, note } of DANGEROUS_PATTERNS) {
            const match = content.match(pattern);
            if (match) {
              // Find line number
              const beforeMatch = content.slice(0, match.index);
              const line = (beforeMatch.match(/\n/g) ?? []).length + 1;

              issues.push({
                severity: "high",
                rule,
                file: filePath,
                line,
                note,
              });
            }
          }
        } catch {
          // File doesn't exist or can't be read — skip
        }
      }

      return {
        layer: "verification",
        pass: issues.filter((i) => i.severity === "high").length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

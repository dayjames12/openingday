import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkerOutput, InterfaceChange } from "../types.js";

const exec = promisify(execFile);

/**
 * Inspect a worktree after a worker completes to build a WorkerOutput
 * from filesystem reality (git diff) rather than from agent self-report.
 */
export async function inspectWorktreeOutput(
  worktreePath: string,
  _taskTouches: string[],
  env: { pm: string; test: string } | null,
): Promise<WorkerOutput> {
  // 1. Get actual files changed via git diff
  const filesChanged = await getChangedFiles(worktreePath);

  // 2. Get the full diff for interface detection
  const diff = await getFullDiff(worktreePath);

  // 3. Parse interface changes from the diff
  const interfacesModified = parseInterfaceChanges(diff);

  // 4. Detect new test files
  const testsAdded = filesChanged.filter((f) => f.endsWith(".test.ts") || f.endsWith(".spec.ts"));

  // 5. Run tests if env is available and a test runner is configured
  let testResults = { pass: 0, fail: 0 };
  if (env && env.test !== "none") {
    testResults = await runTests(worktreePath, env.pm, env.test);
  }

  // 6. Estimate tokens from diff size (rough: ~4 chars per token)
  const tokensUsed = Math.ceil(diff.length / 4);

  // 7. Determine status
  const status = filesChanged.length > 0 ? "complete" : "failed";

  return {
    status,
    filesChanged,
    interfacesModified,
    testsAdded,
    testResults,
    notes: `Inspected from worktree: ${filesChanged.length} file(s) changed`,
    tokensUsed,
  };
}

async function getChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["diff", "--name-only", "HEAD"], { cwd: worktreePath });
    // Also check for untracked files that were added
    const { stdout: untrackedOut } = await exec(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: worktreePath },
    );
    const tracked = stdout.trim().split("\n").filter(Boolean);
    const untracked = untrackedOut.trim().split("\n").filter(Boolean);
    return [...new Set([...tracked, ...untracked])];
  } catch {
    return [];
  }
}

async function getFullDiff(worktreePath: string): Promise<string> {
  try {
    // Staged + unstaged changes against HEAD
    const { stdout } = await exec("git", ["diff", "HEAD"], {
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

const EXPORT_RE = /^([+-])export\s+(?:function|const|class|type|interface|enum)\s+(\w+)/;

/**
 * Parse a unified diff to find export signature changes.
 * Tracks removed (-) and added (+) export lines and matches them by name.
 */
export function parseInterfaceChanges(diff: string): InterfaceChange[] {
  let currentFile = "";
  const removed = new Map<string, { file: string; line: string }>();
  const added = new Map<string, { file: string; line: string }>();

  for (const line of diff.split("\n")) {
    // Track which file we're in
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;

    const match = EXPORT_RE.exec(line);
    if (!match) continue;

    const [, sign, name] = match;
    const key = `${currentFile}::${name}`;
    const cleanLine = line.slice(1).trim(); // remove +/- prefix

    if (sign === "-") {
      removed.set(key, { file: currentFile, line: cleanLine });
    } else {
      added.set(key, { file: currentFile, line: cleanLine });
    }
  }

  // Match removals to additions by key (same file + export name)
  const changes: InterfaceChange[] = [];
  for (const [key, rem] of removed) {
    const add = added.get(key);
    if (add && rem.line !== add.line) {
      const name = key.split("::")[1]!;
      changes.push({
        file: rem.file,
        export: name,
        before: rem.line,
        after: add.line,
      });
    }
  }

  // New exports (added without a corresponding removal)
  for (const [key, add] of added) {
    if (!removed.has(key)) {
      const name = key.split("::")[1]!;
      changes.push({
        file: add.file,
        export: name,
        before: "",
        after: add.line,
      });
    }
  }

  return changes;
}

async function runTests(
  worktreePath: string,
  pm: string,
  testCmd: string,
): Promise<{ pass: number; fail: number }> {
  try {
    const args = testCmd.split(/\s+/);
    const { stdout, stderr } = await exec(pm, args, {
      cwd: worktreePath,
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return parseTestOutput(stdout + stderr);
  } catch (err: unknown) {
    // Tests may exit non-zero on failures but still produce output
    const e = err as { stdout?: string; stderr?: string };
    return parseTestOutput((e.stdout ?? "") + (e.stderr ?? ""));
  }
}

/**
 * Best-effort parsing of test runner output for pass/fail counts.
 * Handles vitest, jest, and mocha output patterns.
 */
export function parseTestOutput(output: string): { pass: number; fail: number } {
  let pass = 0;
  let fail = 0;

  // vitest/jest summary line: "Tests  15 passed (15)" or "Tests  2 failed | 10 passed (12)"
  const testsLine = output.match(/Tests\s+.*?(\d+)\s+passed/);
  if (testsLine) {
    pass = parseInt(testsLine[1]!, 10);
  } else {
    // Fallback: last occurrence of "N passed"
    const allPassed = [...output.matchAll(/(\d+)\s+passed/g)];
    if (allPassed.length > 0) pass = parseInt(allPassed[allPassed.length - 1]![1]!, 10);
  }

  const testsFailLine = output.match(/Tests\s+(\d+)\s+failed/);
  if (testsFailLine) {
    fail = parseInt(testsFailLine[1]!, 10);
  } else {
    const allFailed = [...output.matchAll(/(\d+)\s+failed/g)];
    if (allFailed.length > 0) fail = parseInt(allFailed[allFailed.length - 1]![1]!, 10);
  }

  return { pass, fail };
}

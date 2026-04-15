// packages/core/src/stages/compile.ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageResult, StageFeedback } from "../types.js";
import type { PackageBuildConfig } from "../scanner/types.js";
import { digestCompileErrors } from "./feedback.js";
import { isRtkAvailable } from "../utils/rtk.js";

export interface TscResult {
  exitCode: number;
  output: string;
}

/**
 * Returns true when every touched package has a bundler-only build config (not tsc-compatible).
 * Used to skip `tsc --noEmit` for packages like dashboard that use Vite instead of tsc.
 */
export function shouldSkipCompile(
  touchedFiles?: string[],
  packageConfigs?: Record<string, PackageBuildConfig>,
): boolean {
  if (!touchedFiles || touchedFiles.length === 0 || !packageConfigs) return false;
  const pkgDirs = new Set<string>();
  for (const f of touchedFiles) {
    const match = f.match(/^(packages\/[^/]+)\//);
    if (match) pkgDirs.add(match[1]!);
  }
  if (pkgDirs.size === 0) return false;
  return [...pkgDirs].every((dir) => {
    const config = packageConfigs[dir];
    return config && !config.tscCompatible;
  });
}

/**
 * Fallback check when packageConfigs is unavailable.
 * Reads tsconfig.json directly to detect bundler moduleResolution.
 */
export async function isBundlerPackage(worktreePath: string, pkgDir: string): Promise<boolean> {
  try {
    const tsconfigPath = join(worktreePath, pkgDir, "tsconfig.json");
    const raw = await readFile(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(raw) as { compilerOptions?: { moduleResolution?: string } };
    return tsconfig.compilerOptions?.moduleResolution === "bundler";
  } catch {
    return false;
  }
}

/**
 * Detect which package(s) contain the modified files and return
 * the best tsc target directory. Falls back to worktree root.
 */
export function detectPackageDir(worktreePath: string, touchedFiles?: string[]): string {
  if (!touchedFiles || touchedFiles.length === 0) return worktreePath;

  // Extract unique package dirs from touched file paths (e.g. "packages/core/src/foo.ts" → "packages/core")
  const pkgDirs = new Set<string>();
  for (const f of touchedFiles) {
    const match = f.match(/^(packages\/[^/]+)\//);
    if (match) pkgDirs.add(match[1]!);
  }

  // If all files in one package, scope tsc to that package
  if (pkgDirs.size === 1) {
    const pkgDir = [...pkgDirs][0]!;
    return join(worktreePath, pkgDir);
  }

  return worktreePath;
}

/**
 * Run `tsc --noEmit` in a worktree directory.
 * Scopes to the specific package being modified when possible, avoiding
 * monorepo-wide tsc that fails on unrelated packages (e.g. dashboard tsx).
 * When RTK is available, prefixes the command with `rtk` to compress output
 * before it reaches the AI digest stage (60-90% token reduction).
 * Returns raw exit code and output for further processing.
 */
export function runTsc(worktreePath: string, touchedFiles?: string[]): Promise<TscResult> {
  const useRtk = isRtkAvailable();
  const pkgDir = detectPackageDir(worktreePath, touchedFiles);
  // Run tsc from worktree root with --project flag to keep node_modules resolution working
  // (pnpm hoists deps to root, so running tsc inside a package dir fails to find them)
  const tscProject = pkgDir !== worktreePath ? pkgDir.replace(worktreePath + "/", "") + "/tsconfig.json" : undefined;
  const cmd = useRtk ? "rtk" : "npx";
  const baseArgs = useRtk ? ["npx", "tsc", "--noEmit"] : ["tsc", "--noEmit"];
  const args = tscProject ? [...baseArgs, "--project", tscProject] : baseArgs;

  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: worktreePath, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        const err = error as Error & { code?: number; stdout?: string; stderr?: string };
        resolve({
          exitCode: typeof err.code === "number" ? err.code : 1,
          output: (err.stdout ?? stdout ?? "") + (err.stderr ?? stderr ?? ""),
        });
      } else {
        resolve({ exitCode: 0, output: (stdout ?? "") + (stderr ?? "") });
      }
    });
  });
}

/**
 * Run the compile stage for a task worktree.
 * Executes tsc --noEmit. On failure, calls AI to digest errors into structured feedback.
 * Does NOT loop internally — the caller (orchestrator) handles the loop.
 * Skips tsc entirely when all touched packages are bundler-only (e.g. Vite dashboard).
 */
export async function runCompileStage(
  worktreePath: string,
  taskBudget: number,
  touchedFiles?: string[],
  packageConfigs?: Record<string, PackageBuildConfig>,
): Promise<StageResult> {
  const passResult: StageResult = { stage: "compile", passed: true, loops: 0, feedback: [] };

  // Skip when all touched packages are known bundler-only packages
  if (shouldSkipCompile(touchedFiles, packageConfigs)) {
    return passResult;
  }

  // Fallback: no packageConfigs — check tsconfig directly for single-package edits
  if (!packageConfigs && touchedFiles && touchedFiles.length > 0) {
    const pkgDirs = new Set<string>();
    for (const f of touchedFiles) {
      const match = f.match(/^(packages\/[^/]+)\//);
      if (match) pkgDirs.add(match[1]!);
    }
    if (pkgDirs.size > 0) {
      const checks = await Promise.all([...pkgDirs].map((dir) => isBundlerPackage(worktreePath, dir)));
      if (checks.every(Boolean)) return passResult;
    }
  }

  const tscResult = await runTsc(worktreePath, touchedFiles);

  if (tscResult.exitCode === 0) {
    return passResult;
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

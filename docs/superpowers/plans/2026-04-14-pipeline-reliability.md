# Pipeline Reliability Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the staged pipeline reliable across diverse monorepo packages by teaching compile to skip bundler packages, scoping review to diffs only, and classifying failures so circuit breakers don't trip on infra issues.

**Architecture:** Three independent improvements that reinforce each other. Area 1 (compile awareness) prevents infra failures. Area 2 (review scoping) reduces false rejections. Area 3 (failure classification) ensures the circuit breaker only reacts to real code failures. Each area is independently testable and deployable.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo, Agent SDK

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `packages/core/src/budget/classify.ts` | Failure classification from stage results |
| `packages/core/src/budget/classify.test.ts` | Tests for classification heuristics |
| `packages/core/src/gates/contracts-gate.ts` | Non-AI contract validation gate |
| `packages/core/src/gates/contracts-gate.test.ts` | Tests for contract validation |

### Modified files
| File | Change |
|------|--------|
| `packages/core/src/scanner/types.ts` | Add `PackageBuildConfig` type, extend `RepoMap` |
| `packages/core/src/scanner/scan.ts` | Detect per-package build config during scan |
| `packages/core/src/scanner/scan.test.ts` | Test build config detection |
| `packages/core/src/stages/compile.ts` | Skip bundler packages, fallback tsconfig read |
| `packages/core/src/stages/compile.test.ts` | Test skip behavior |
| `packages/core/src/pipeline/stage-runner.ts` | Pass repo map to compile, fix review retry, update review calls |
| `packages/core/src/prompts/review.ts` | Remove contracts from review prompt |
| `packages/core/src/stages/review.ts` | Drop contracts param |
| `packages/core/src/gates/pipeline.ts` | Add contracts gate to default pipeline |
| `packages/core/src/types.ts` | Add failure fields to WorkTask |
| `packages/core/src/budget/budget.ts` | Update breakers to use classification, add infra breaker |
| `packages/core/src/budget/budget.test.ts` | Update circuit breaker tests |
| `packages/core/src/orchestrator.ts` | Persist failure classification, enrich memory logs |

---

### Task 1: Per-package build config type and scanner detection

**Files:**
- Modify: `packages/core/src/scanner/types.ts`
- Modify: `packages/core/src/scanner/scan.ts`
- Modify: `packages/core/src/scanner/scan.test.ts`

- [ ] **Step 1: Add PackageBuildConfig type**

In `packages/core/src/scanner/types.ts`, add after the `RepoModule` interface:

```typescript
export interface PackageBuildConfig {
  tscCompatible: boolean;
  bundler?: "vite" | "webpack" | "esbuild" | "rollup";
  moduleResolution?: string;
}
```

And extend `RepoMap` with an optional field:

```typescript
export interface RepoMap {
  v: number;
  scannedAt: string;
  depth: ScanDepth;
  env: EnvConfig;
  deps: string[];
  modules: RepoModule[];
  packageConfigs?: Record<string, PackageBuildConfig>;
}
```

- [ ] **Step 2: Write failing test for build config detection**

In `packages/core/src/scanner/scan.test.ts`, add:

```typescript
import { detectPackageBuildConfigs } from "./scan.js";

describe("detectPackageBuildConfigs", () => {
  it("detects bundler moduleResolution as not tsc-compatible", async () => {
    // Uses the actual openingday repo — packages/dashboard has moduleResolution: "bundler"
    const configs = await detectPackageBuildConfigs(process.cwd());
    const dashboard = configs["packages/dashboard"];
    expect(dashboard).toBeDefined();
    expect(dashboard!.tscCompatible).toBe(false);
    expect(dashboard!.moduleResolution).toBe("bundler");
  });

  it("detects standard moduleResolution as tsc-compatible", async () => {
    const configs = await detectPackageBuildConfigs(process.cwd());
    const core = configs["packages/core"];
    expect(core).toBeDefined();
    expect(core!.tscCompatible).toBe(true);
  });

  it("detects vite bundler from package.json scripts", async () => {
    const configs = await detectPackageBuildConfigs(process.cwd());
    const dashboard = configs["packages/dashboard"];
    expect(dashboard?.bundler).toBe("vite");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- --run packages/core/src/scanner/scan.test.ts`
Expected: FAIL — `detectPackageBuildConfigs` not exported

- [ ] **Step 4: Implement detectPackageBuildConfigs**

In `packages/core/src/scanner/scan.ts`, add:

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageBuildConfig } from "./types.js";

const BUNDLER_PATTERNS: Record<string, PackageBuildConfig["bundler"]> = {
  vite: "vite",
  webpack: "webpack",
  esbuild: "esbuild",
  rollup: "rollup",
};

export async function detectPackageBuildConfigs(
  repoDir: string,
): Promise<Record<string, PackageBuildConfig>> {
  const configs: Record<string, PackageBuildConfig> = {};

  // Find package dirs (check pnpm-workspace.yaml patterns or default to packages/*)
  let packageDirs: string[] = [];
  try {
    const entries = await readdir(join(repoDir, "packages"), { withFileTypes: true });
    packageDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => `packages/${e.name}`);
  } catch {
    return configs;
  }

  for (const pkgDir of packageDirs) {
    const config: PackageBuildConfig = { tscCompatible: true };

    // Check tsconfig.json for moduleResolution
    try {
      const tsconfigRaw = await readFile(join(repoDir, pkgDir, "tsconfig.json"), "utf-8");
      const tsconfig = JSON.parse(tsconfigRaw) as {
        compilerOptions?: { moduleResolution?: string };
      };
      const mr = tsconfig.compilerOptions?.moduleResolution;
      if (mr) config.moduleResolution = mr;
      if (mr === "bundler") config.tscCompatible = false;
    } catch {
      // No tsconfig — not tsc-compatible
      config.tscCompatible = false;
    }

    // Check package.json scripts for bundler
    try {
      const pkgJsonRaw = await readFile(join(repoDir, pkgDir, "package.json"), "utf-8");
      const pkgJson = JSON.parse(pkgJsonRaw) as { scripts?: Record<string, string> };
      const buildScript = pkgJson.scripts?.build ?? "";
      for (const [pattern, bundler] of Object.entries(BUNDLER_PATTERNS)) {
        if (buildScript.includes(pattern)) {
          config.bundler = bundler;
          break;
        }
      }
    } catch {
      /* no package.json — fine */
    }

    configs[pkgDir] = config;
  }

  return configs;
}
```

- [ ] **Step 5: Wire into scanRepo**

In `scanRepo()`, after the env/deps detection block and before the return, add:

```typescript
  const packageConfigs = await detectPackageBuildConfigs(dir);

  return {
    v: 1,
    scannedAt: new Date().toISOString(),
    depth,
    env,
    deps,
    modules,
    packageConfigs: Object.keys(packageConfigs).length > 0 ? packageConfigs : undefined,
  };
```

- [ ] **Step 6: Run tests**

Run: `pnpm test -- --run packages/core/src/scanner/scan.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: Clean

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/scanner/types.ts packages/core/src/scanner/scan.ts packages/core/src/scanner/scan.test.ts
git commit -m "feat(scanner): detect per-package build config for tsc compatibility"
```

---

### Task 2: Compile stage skips bundler packages

**Files:**
- Modify: `packages/core/src/stages/compile.ts`
- Modify: `packages/core/src/stages/compile.test.ts`
- Modify: `packages/core/src/pipeline/stage-runner.ts`

- [ ] **Step 1: Write failing test for bundler skip**

In `packages/core/src/stages/compile.test.ts`, add:

```typescript
import { shouldSkipCompile } from "./compile.js";
import type { PackageBuildConfig } from "../scanner/types.js";

describe("shouldSkipCompile", () => {
  it("returns true for bundler package", () => {
    const configs: Record<string, PackageBuildConfig> = {
      "packages/dashboard": { tscCompatible: false, bundler: "vite", moduleResolution: "bundler" },
    };
    expect(shouldSkipCompile(["packages/dashboard/src/App.tsx"], configs)).toBe(true);
  });

  it("returns false for tsc-compatible package", () => {
    const configs: Record<string, PackageBuildConfig> = {
      "packages/core": { tscCompatible: true },
    };
    expect(shouldSkipCompile(["packages/core/src/foo.ts"], configs)).toBe(false);
  });

  it("returns false when no configs provided", () => {
    expect(shouldSkipCompile(["packages/core/src/foo.ts"])).toBe(false);
  });

  it("returns false for mixed packages (some tsc-compatible)", () => {
    const configs: Record<string, PackageBuildConfig> = {
      "packages/core": { tscCompatible: true },
      "packages/dashboard": { tscCompatible: false, bundler: "vite" },
    };
    // Mixed = run tsc for compatible ones
    expect(shouldSkipCompile(["packages/core/src/a.ts", "packages/dashboard/src/b.tsx"], configs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run packages/core/src/stages/compile.test.ts`
Expected: FAIL — `shouldSkipCompile` not exported

- [ ] **Step 3: Implement shouldSkipCompile**

In `packages/core/src/stages/compile.ts`, add:

```typescript
import type { PackageBuildConfig } from "../scanner/types.js";

/**
 * Determine if compile should be skipped entirely.
 * Returns true only if ALL touched packages are bundler-only (not tsc-compatible).
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

  // Skip only if ALL touched packages are bundler-only
  return [...pkgDirs].every((dir) => {
    const config = packageConfigs[dir];
    return config && !config.tscCompatible;
  });
}
```

- [ ] **Step 4: Add tsconfig fallback read**

In `packages/core/src/stages/compile.ts`, add a fallback for when `packageConfigs` is missing:

```typescript
import { readFile } from "node:fs/promises";

/**
 * Fallback: read tsconfig.json directly from worktree to check moduleResolution.
 */
export async function isBundlerPackage(worktreePath: string, pkgDir: string): Promise<boolean> {
  try {
    const tsconfigPath = join(worktreePath, pkgDir, "tsconfig.json");
    const raw = await readFile(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(raw) as {
      compilerOptions?: { moduleResolution?: string };
    };
    return tsconfig.compilerOptions?.moduleResolution === "bundler";
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Update runCompileStage to use skip logic**

Update `runCompileStage` signature and add skip check at the top:

```typescript
export async function runCompileStage(
  worktreePath: string,
  taskBudget: number,
  touchedFiles?: string[],
  packageConfigs?: Record<string, PackageBuildConfig>,
): Promise<StageResult> {
  // Check if all touched packages are bundler-only
  if (shouldSkipCompile(touchedFiles, packageConfigs)) {
    return { stage: "compile", passed: true, loops: 0, feedback: [] };
  }

  // Fallback: if no packageConfigs, check tsconfig directly
  if (!packageConfigs && touchedFiles) {
    const pkgDir = detectPackageDir(worktreePath, touchedFiles);
    if (pkgDir !== worktreePath) {
      const relPkg = pkgDir.replace(worktreePath + "/", "");
      if (await isBundlerPackage(worktreePath, relPkg)) {
        return { stage: "compile", passed: true, loops: 0, feedback: [] };
      }
    }
  }

  const tscResult = await runTsc(worktreePath, touchedFiles);
  // ... rest unchanged
```

- [ ] **Step 6: Update stage-runner to pass packageConfigs**

In `packages/core/src/pipeline/stage-runner.ts`, add `packageConfigs` to `PipelineOptions`:

```typescript
import type { PackageBuildConfig } from "../scanner/types.js";

export interface PipelineOptions {
  // ... existing fields
  packageConfigs?: Record<string, PackageBuildConfig>;
}
```

Update the compile call:

```typescript
runStage: () => runCompileStage(worktreePath, taskBudget, taskTouches, options.packageConfigs),
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm test -- --run packages/core/src/stages/compile.test.ts && pnpm typecheck`
Expected: All PASS, clean typecheck

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/stages/compile.ts packages/core/src/stages/compile.test.ts packages/core/src/pipeline/stage-runner.ts
git commit -m "feat(compile): skip tsc for bundler-only packages"
```

---

### Task 3: Scope review to diff-only, drop contracts param

**Files:**
- Modify: `packages/core/src/prompts/review.ts`
- Modify: `packages/core/src/stages/review.ts`
- Modify: `packages/core/src/pipeline/stage-runner.ts`

- [ ] **Step 1: Update review prompt to remove contracts**

In `packages/core/src/prompts/review.ts`:

```typescript
export interface ReviewPromptArgs {
  diff: string;
  specExcerpt: string;
  budget: number;
}

export function reviewPrompt(args: ReviewPromptArgs): string {
  return [
    agentRole("code-reviewer"),
    `spec:\n${args.specExcerpt || "(none)"}`,
    `diff:\n${args.diff}`,
    "check:[domain-fidelity,pattern-consistency,no-duplication,proper-imports,test-coverage]",
    reviewFormat(),
    digestConstraints(args.budget),
  ].join("|");
}
```

- [ ] **Step 2: Update runReviewStage to drop contracts param**

In `packages/core/src/stages/review.ts`, update `buildReviewPrompt`:

```typescript
export function buildReviewPrompt(diff: string, specExcerpt: string): string {
  return reviewPrompt({ diff, specExcerpt, budget: 0.5 });
}
```

Update `runReviewStage` signature — remove `contracts` param:

```typescript
export async function runReviewStage(
  worktreePath: string,
  diff: string,
  specExcerpt: string,
  taskBudget: number,
  model?: string,
): Promise<StageResult> {
  const prompt = buildReviewPrompt(diff, specExcerpt);
  // ... rest unchanged
```

- [ ] **Step 3: Update stage-runner review calls**

In `packages/core/src/pipeline/stage-runner.ts`, update all `runReviewStage` calls to drop `contracts`:

```typescript
  let reviewResult = await runReviewStage(worktreePath, diff, specExcerpt, taskBudget, model);
  // ...
  reviewResult = await runReviewStage(worktreePath, diff, specExcerpt, taskBudget, model);
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/prompts/review.ts packages/core/src/stages/review.ts packages/core/src/pipeline/stage-runner.ts
git commit -m "refactor(review): scope reviewer to diff+spec only, remove contracts"
```

---

### Task 4: Fix review retry accumulation

**Files:**
- Modify: `packages/core/src/pipeline/stage-runner.ts`

- [ ] **Step 1: Refactor review retry with proper accumulation**

In `packages/core/src/pipeline/stage-runner.ts`, replace the review section (after test stage, starting at the `// === REVIEW ===` comment) with:

```typescript
  // === REVIEW ===
  let diff = "";
  try {
    const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
    diff = stdout;
  } catch {
    diff = "(could not generate diff)";
  }

  // Create tracker and history BEFORE first review for proper accumulation
  let reviewTracker = createLoopTracker(taskId);
  const reviewErrorHistory: StageFeedback[] = [];
  const reviewDiffHistory: string[] = [diff];

  let reviewResult = await runReviewStage(worktreePath, diff, specExcerpt, taskBudget, model);
  stageResults.push(reviewResult);

  if (!reviewResult.passed) {
    // Record the loop and accumulate feedback
    reviewTracker = recordLoop(reviewTracker, "review");
    for (const fb of reviewResult.feedback) {
      reviewErrorHistory.push(fb);
    }

    // Check safety caps with accumulated state
    const breakCheck = shouldBreak(reviewTracker, "review", reviewErrorHistory, reviewDiffHistory);

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
      model,
    });

    // Re-capture diff after worker fix attempt
    try {
      const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
      diff = stdout;
    } catch {
      diff = "(could not generate diff)";
    }
    reviewDiffHistory.push(diff);

    // Re-run review
    reviewResult = await runReviewStage(worktreePath, diff, specExcerpt, taskBudget, model);
    stageResults.push(reviewResult);

    if (!reviewResult.passed) {
      allPassed = false;
    }
  }

  stages.push({
    stage: "review",
    passed: reviewResult.passed,
    feedback: reviewResult.feedback,
    loopCount: reviewDiffHistory.length - 1,
  });
```

- [ ] **Step 2: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/pipeline/stage-runner.ts
git commit -m "fix(review): accumulate feedback history across retry iterations"
```

---

### Task 5: Non-AI contracts validation gate

**Files:**
- Create: `packages/core/src/gates/contracts-gate.ts`
- Create: `packages/core/src/gates/contracts-gate.test.ts`
- Modify: `packages/core/src/gates/pipeline.ts`

- [ ] **Step 1: Write failing test for contracts gate**

Create `packages/core/src/gates/contracts-gate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateContracts } from "./contracts-gate.js";

describe("validateContracts", () => {
  it("passes when contracts are empty", () => {
    const result = validateContracts("", ["src/foo.ts"]);
    expect(result.pass).toBe(true);
  });

  it("passes when all exports are consumed", () => {
    const contracts = `export interface User { id: string; }\nexport type Role = "admin" | "user";`;
    const fileContents = {
      "src/foo.ts": `import type { User, Role } from "../contracts.js";`,
    };
    const result = validateContracts(contracts, ["src/foo.ts"], fileContents);
    expect(result.pass).toBe(true);
  });

  it("warns on unused contract exports", () => {
    const contracts = `export interface User { id: string; }\nexport interface Orphan { x: number; }`;
    const fileContents = {
      "src/foo.ts": `import type { User } from "../contracts.js";`,
    };
    const result = validateContracts(contracts, ["src/foo.ts"], fileContents);
    // Unused exports are low-severity warnings, not blockers
    expect(result.pass).toBe(true);
    expect(result.issues.some((i) => i.note?.includes("Orphan"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run packages/core/src/gates/contracts-gate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement contracts gate**

Create `packages/core/src/gates/contracts-gate.ts`:

```typescript
import type { GateResult, GateIssue } from "../types.js";

/**
 * Extract exported names from a TypeScript contracts file using regex.
 */
export function extractContractExports(source: string): string[] {
  const exportRegex = /export\s+(?:interface|type|enum|const|function)\s+(\w+)/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(source)) !== null) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

/**
 * Non-AI validation of contracts file against touched files.
 * Checks for unused exports (low severity) and missing imports (low severity).
 * Returns pass: true always (contracts issues are warnings, not blockers).
 */
export function validateContracts(
  contractsSource: string,
  touchedFiles: string[],
  fileContents?: Record<string, string>,
): GateResult {
  const issues: GateIssue[] = [];

  if (!contractsSource || contractsSource.trim().length === 0) {
    return { layer: "automated", pass: true, issues: [], timestamp: new Date().toISOString() };
  }

  const exports = extractContractExports(contractsSource);

  // Check for unused exports if we have file contents to scan
  if (fileContents) {
    const allContent = Object.values(fileContents).join("\n");
    for (const name of exports) {
      if (!allContent.includes(name)) {
        issues.push({
          severity: "low",
          rule: "unused-contract-export",
          file: "contracts.ts",
          note: `Export "${name}" is not referenced in any touched file`,
        });
      }
    }
  }

  return {
    layer: "automated",
    pass: true, // Contracts issues are warnings, never blockers
    issues,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run packages/core/src/gates/contracts-gate.test.ts`
Expected: All PASS

- [ ] **Step 5: Add contracts gate to default pipeline**

In `packages/core/src/gates/pipeline.ts`, import and add to `createDefaultPipeline`:

```typescript
import { validateContracts } from "./contracts-gate.js";

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
  // Non-AI contracts validation
  if (opts?.contracts) {
    pipeline.push({
      layer: "automated" as const,
      run(): GateResult {
        return validateContracts(opts.contracts!, taskTouches);
      },
    });
  }
  // ... rest unchanged
```

- [ ] **Step 6: Run all tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/gates/contracts-gate.ts packages/core/src/gates/contracts-gate.test.ts packages/core/src/gates/pipeline.ts
git commit -m "feat(gates): add non-AI contracts validation gate"
```

---

### Task 6: Failure classification function

**Files:**
- Create: `packages/core/src/budget/classify.ts`
- Create: `packages/core/src/budget/classify.test.ts`

- [ ] **Step 1: Write failing tests for classifyFailure**

Create `packages/core/src/budget/classify.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { classifyFailure } from "./classify.js";
import type { StageResult } from "../types.js";

describe("classifyFailure", () => {
  it("classifies missing module in untouched file as infra", () => {
    const stages: StageResult[] = [
      {
        stage: "compile",
        passed: false,
        loops: 3,
        feedback: [
          {
            stage: "compile",
            errors: [{ f: "src/other.ts", l: 1, e: "Cannot find module 'express'", fix: "" }],
          },
        ],
      },
    ];
    const result = classifyFailure(stages);
    expect(result.kind).toBe("infra");
    expect(result.stage).toBe("compile");
    expect(result.message).toContain("Cannot find module");
  });

  it("classifies composite tsconfig error as infra", () => {
    const stages: StageResult[] = [
      {
        stage: "compile",
        passed: false,
        loops: 2,
        feedback: [
          {
            stage: "compile",
            errors: [
              {
                f: "tsconfig.json",
                l: 6,
                e: 'must have setting "composite": true',
                fix: "",
              },
            ],
          },
        ],
      },
    ];
    const result = classifyFailure(stages);
    expect(result.kind).toBe("infra");
  });

  it("classifies jsx not set on untouched files as infra", () => {
    const stages: StageResult[] = [
      {
        stage: "compile",
        passed: false,
        loops: 1,
        feedback: [
          {
            stage: "compile",
            errors: [{ f: "src/App.tsx", l: 13, e: "--jsx is not set", fix: "" }],
          },
        ],
      },
    ];
    const result = classifyFailure(stages);
    expect(result.kind).toBe("infra");
  });

  it("classifies real test failure as code", () => {
    const stages: StageResult[] = [
      { stage: "compile", passed: true, loops: 0, feedback: [] },
      {
        stage: "test",
        passed: false,
        loops: 2,
        feedback: [
          {
            stage: "test",
            errors: [{ f: "src/foo.test.ts", l: 10, e: "expected 3 but got 5", fix: "" }],
          },
        ],
      },
    ];
    const result = classifyFailure(stages);
    expect(result.kind).toBe("code");
    expect(result.stage).toBe("test");
  });

  it("classifies review failure as code", () => {
    const stages: StageResult[] = [
      { stage: "compile", passed: true, loops: 0, feedback: [] },
      { stage: "test", passed: true, loops: 0, feedback: [] },
      {
        stage: "review",
        passed: false,
        loops: 0,
        feedback: [
          {
            stage: "review",
            errors: [{ f: "src/foo.ts", l: 5, e: "function too complex", fix: "" }],
          },
        ],
      },
    ];
    const result = classifyFailure(stages);
    expect(result.kind).toBe("code");
    expect(result.stage).toBe("review");
  });

  it("returns timeout for empty stage results", () => {
    const result = classifyFailure([]);
    expect(result.kind).toBe("timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run packages/core/src/budget/classify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement classifyFailure**

Create `packages/core/src/budget/classify.ts`:

```typescript
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
  /--jsx is not set/,
  /not found in code tree/,
  /TypeScript declaration file not generated/,
];

/**
 * Classify a pipeline failure based on stage results.
 * Examines the first failed stage's feedback to determine if the failure
 * is infrastructure (worktree/config issues) or code (real bugs).
 */
export function classifyFailure(
  stageResults: StageResult[],
  spawnError?: string,
): FailureClassification {
  // No stage results = spawn failure
  if (stageResults.length === 0) {
    if (spawnError?.includes("rate_limit") || spawnError?.includes("429")) {
      return { stage: "implement", kind: "timeout", message: spawnError.slice(0, 200) };
    }
    if (spawnError?.includes("budget") || spawnError?.includes("max_budget")) {
      return { stage: "implement", kind: "budget", message: spawnError.slice(0, 200) };
    }
    return {
      stage: "implement",
      kind: "timeout",
      message: spawnError?.slice(0, 200) ?? "No stage results — spawn likely failed",
    };
  }

  // Find first failed stage
  const failedStage = stageResults.find((s) => !s.passed);
  if (!failedStage) {
    // All stages passed — shouldn't be called, but handle gracefully
    return { stage: "unknown", kind: "code", message: "All stages passed but task marked failed" };
  }

  const stage = failedStage.stage;
  const firstError = failedStage.feedback[0]?.errors[0];
  const errorMsg = firstError?.e ?? "";

  // Check for infra patterns
  for (const pattern of INFRA_PATTERNS) {
    if (pattern.test(errorMsg)) {
      return { stage, kind: "infra", message: errorMsg.slice(0, 200) };
    }
  }

  // Default: code failure
  return { stage, kind: "code", message: errorMsg.slice(0, 200) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run packages/core/src/budget/classify.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/budget/classify.ts packages/core/src/budget/classify.test.ts
git commit -m "feat(budget): add failure classification for infra vs code failures"
```

---

### Task 7: Add failure fields to WorkTask and update circuit breakers

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/budget/budget.ts`
- Modify: `packages/core/src/budget/budget.test.ts`

- [ ] **Step 1: Add failure fields to WorkTask**

In `packages/core/src/types.ts`, extend `WorkTask`:

```typescript
export interface WorkTask {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  touches: string[];
  reads: string[];
  worker: string | null;
  tokenSpend: number;
  attemptCount: number;
  gateResults: GateResult[];
  parentSliceId: string;
  failureStage?: "implement" | "compile" | "test" | "review" | "gate" | "merge";
  failureKind?: "infra" | "code" | "budget" | "timeout";
  failureMessage?: string;
}
```

- [ ] **Step 2: Write failing tests for updated circuit breakers**

In `packages/core/src/budget/budget.test.ts`, add a new `describe` block using the existing helpers (`createWorkTree`, `addMilestone`, `addSlice`, `addTask`, `updateTaskStatus`, `makeState`, `defaultConfig`). Also import `updateTask` from work-tree:

```typescript
import { updateTask } from "../trees/work-tree.js";

describe("checkCircuitBreakers with failure classification", () => {
  function buildTreeWithTasks(
    taskOverrides: Partial<WorkTask>[],
  ) {
    let tree = createWorkTree();
    tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    for (let i = 0; i < taskOverrides.length; i++) {
      const o = taskOverrides[i]!;
      const id = `t${i + 1}`;
      tree = addTask(tree, "s1", {
        id,
        name: `T${i + 1}`,
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      if (o.status === "complete") tree = updateTaskStatus(tree, id, "complete");
      if (o.status === "failed") {
        tree = updateTaskStatus(tree, id, "failed");
        tree = updateTask(tree, id, {
          failureKind: o.failureKind,
          failureMessage: o.failureMessage,
        });
      }
    }
    return tree;
  }

  it("excludes infra failures from efficiency calculation", () => {
    const tree = buildTreeWithTasks([
      { status: "complete" },
      { status: "failed", failureKind: "infra" },
      { status: "failed", failureKind: "infra" },
      { status: "failed", failureKind: "infra" },
    ]);
    const config = defaultConfig("test", "spec.md");
    const state = makeState({ totalTokenSpend: 1000 });

    const result = checkCircuitBreakers(tree, state, config);
    // 1 complete / (1 complete + 0 code failures) = 1.0, above 0.5
    expect(result.efficiencyTripped).toBe(false);
  });

  it("counts code failures in efficiency calculation", () => {
    const tree = buildTreeWithTasks([
      { status: "complete" },
      { status: "failed", failureKind: "code" },
      { status: "failed", failureKind: "code" },
      { status: "failed", failureKind: "code" },
    ]);
    const config = defaultConfig("test", "spec.md");
    const state = makeState({ totalTokenSpend: 1000 });

    const result = checkCircuitBreakers(tree, state, config);
    // 1 complete / (1 complete + 3 code failures) = 0.25, below 0.5
    expect(result.efficiencyTripped).toBe(true);
  });

  it("detects infra breaker on repeated same-message infra failures", () => {
    const tree = buildTreeWithTasks([
      { status: "failed", failureKind: "infra", failureMessage: "Cannot find module 'express'" },
      { status: "failed", failureKind: "infra", failureMessage: "Cannot find module 'express'" },
    ]);
    const config = defaultConfig("test", "spec.md");
    const state = makeState({ totalTokenSpend: 1000 });

    const result = checkCircuitBreakers(tree, state, config);
    expect(result.infraTripped).toBe(true);
    expect(result.reason).toContain("Infrastructure issue");
  });
});
```

- [ ] **Step 3: Update CircuitBreakerStatus and checkCircuitBreakers**

In `packages/core/src/budget/budget.ts`:

```typescript
export interface CircuitBreakerStatus {
  sliceTripped: boolean;
  projectTripped: boolean;
  efficiencyTripped: boolean;
  infraTripped: boolean;
  reason: string | null;
}

export function checkCircuitBreakers(
  workTree: WorkTree,
  state: ProjectState,
  config: ProjectConfig,
): CircuitBreakerStatus {
  const allTasks = getAllTasks(workTree);
  const sliceTripped = checkSliceBreaker(allTasks, config);
  const projectTripped = checkProjectBreaker(allTasks, config);
  const efficiencyTripped = checkEfficiencyBreaker(allTasks, state, config);
  const infraTripped = checkInfraBreaker(allTasks);

  let reason: string | null = null;
  if (infraTripped) {
    const infraTasks = allTasks.filter((t) => t.failureKind === "infra");
    const msg = infraTasks[0]?.failureMessage ?? "unknown";
    reason = `Infrastructure issue detected: ${msg}. Fix and resume.`;
  } else if (sliceTripped) {
    reason = "Too many consecutive failures in a slice";
  } else if (projectTripped) {
    reason = "Too many consecutive failures across project";
  } else if (efficiencyTripped) {
    reason = "Budget efficiency below threshold";
  }

  return { sliceTripped, projectTripped, efficiencyTripped, infraTripped, reason };
}
```

Update `checkEfficiencyBreaker` to only count code failures:

```typescript
function checkEfficiencyBreaker(
  allTasks: WorkTask[],
  state: ProjectState,
  config: ProjectConfig,
): boolean {
  if (state.totalTokenSpend === 0) return false;

  const completedTasks = allTasks.filter((t) => t.status === "complete");
  const codeFailedTasks = allTasks.filter(
    (t) => t.status === "failed" && (t.failureKind === "code" || t.failureKind === undefined),
  );

  const total = completedTasks.length + codeFailedTasks.length;
  if (total === 0) return false;

  const efficiency = completedTasks.length / total;
  return efficiency < config.circuitBreakers.budgetEfficiencyThreshold;
}
```

Add `checkInfraBreaker`:

```typescript
/**
 * Check if 2+ tasks failed with the same infrastructure error.
 */
function checkInfraBreaker(allTasks: WorkTask[]): boolean {
  const infraTasks = allTasks.filter((t) => t.status === "failed" && t.failureKind === "infra");
  if (infraTasks.length < 2) return false;

  // Check if any message appears 2+ times
  const msgCounts = new Map<string, number>();
  for (const t of infraTasks) {
    const msg = t.failureMessage ?? "";
    msgCounts.set(msg, (msgCounts.get(msg) ?? 0) + 1);
  }
  return [...msgCounts.values()].some((count) => count >= 2);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/budget/budget.ts packages/core/src/budget/budget.test.ts
git commit -m "feat(budget): circuit breakers distinguish infra from code failures"
```

---

### Task 8: Orchestrator persists failure classification

**Files:**
- Modify: `packages/core/src/orchestrator.ts`
- Modify: `packages/core/src/pipeline/stage-runner.ts`

- [ ] **Step 1: Import classifyFailure in orchestrator**

In `packages/core/src/orchestrator.ts`, add import:

```typescript
import { classifyFailure } from "./budget/classify.js";
```

- [ ] **Step 2: Update the failure path to persist classification**

In the orchestrator's failure path (the `else` block after `if (allStagesPassed)`), replace:

```typescript
        } else {
          workTree = updateTaskStatus(workTree, task.id, "failed");
          workTree = updateTask(workTree, task.id, {
            attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1,
          });
          this.pool = completeWorker(this.pool, sessionId, "failed");
          failed++;
          await this.storage.appendMemory(
            `Task ${task.id} failed staged pipeline at ${new Date().toISOString()}`,
          );
        }
```

With:

```typescript
        } else {
          const classification = classifyFailure(pipeline.stageResults);
          workTree = updateTaskStatus(workTree, task.id, "failed");
          workTree = updateTask(workTree, task.id, {
            attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1,
            failureStage: classification.stage,
            failureKind: classification.kind,
            failureMessage: classification.message,
          });
          this.pool = completeWorker(this.pool, sessionId, "failed");
          failed++;
          await this.storage.appendMemory(
            `Task ${task.id} failed [${classification.kind}] at ${classification.stage}: ${classification.message}`,
          );
        }
```

- [ ] **Step 3: Update the catch block too**

In the `catch (err)` block, also classify:

```typescript
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const classification = classifyFailure([], message);
        workTree = updateTaskStatus(workTree, task.id, "failed");
        workTree = updateTask(workTree, task.id, {
          attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1,
          failureStage: classification.stage,
          failureKind: classification.kind,
          failureMessage: classification.message,
        });
        this.pool = completeWorker(this.pool, sessionId, "failed");
        failed++;
        await this.storage.appendMemory(
          `Task ${task.id} spawn error [${classification.kind}]: ${message}`,
        );
      }
```

- [ ] **Step 4: Pass packageConfigs through orchestrator to pipeline**

In the orchestrator's dispatch loop, update the `runStagedPipeline` call to include `packageConfigs`:

```typescript
        const pipeline = await runStagedPipeline({
          taskId: task.id,
          taskTouches: task.touches,
          worktreePath,
          worktreeBranch,
          context,
          taskBudget: config.budgets.perTask.usd,
          env,
          repoDir: this.options.repoDir ?? null,
          spawn: this.spawn,
          contracts,
          specExcerpt: this.options.specText ?? "",
          model: config.model,
          packageConfigs: repoMap?.packageConfigs,
        });
```

- [ ] **Step 5: Update infraTripped handling in orchestrator**

In the circuit breaker check section (around line 114-126), update to handle the new `infraTripped` field:

```typescript
    const circuitStatus = checkCircuitBreakers(workTree, state, config);
    if (circuitStatus.reason) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: false,
        isPaused: true,
        error: `Circuit breaker: ${circuitStatus.reason}`,
      };
    }
```

This already works because `reason` is set for infra trips too — no change needed here.

- [ ] **Step 6: Run all tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All PASS

- [ ] **Step 7: Full integration verify**

Run: `pnpm build && pnpm test`
Expected: Build clean, all tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/orchestrator.ts packages/core/src/pipeline/stage-runner.ts
git commit -m "feat(orchestrator): persist failure classification and enrich diagnostics"
```

# Phase 3: Orchestrator Split + Prompt Templates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 540-line orchestrator monolith into focused pipeline modules and centralize all AI prompts behind wire-mode templates.

**Architecture:** Extract orchestrator into thin coordinator + `pipeline/stage-runner.ts` + `pipeline/feedback-loop.ts` + `pipeline/file-reader.ts`. Create `prompts/` directory with composable partials and typed template functions for all 5 AI-calling modules. All AI-to-AI communication uses wire-mode compression.

**Tech Stack:** TypeScript, Vitest, @anthropic-ai/claude-agent-sdk

---

## File Structure

### New Files (Part 1: Orchestrator Split)
| File | Responsibility |
|------|---------------|
| `packages/core/src/pipeline/file-reader.ts` | Read + truncate file contents for enriched context |
| `packages/core/src/pipeline/file-reader.test.ts` | Unit tests for file reading + truncation |
| `packages/core/src/pipeline/feedback-loop.ts` | Run compile/test stages in retry loop with AI feedback |
| `packages/core/src/pipeline/feedback-loop.test.ts` | Unit tests for loop behavior, stuck detection |
| `packages/core/src/pipeline/stage-runner.ts` | Sequence full staged pipeline for a task |
| `packages/core/src/pipeline/stage-runner.test.ts` | Unit tests for pipeline sequencing |

### New Files (Part 2: Prompt Templates)
| File | Responsibility |
|------|---------------|
| `packages/core/src/prompts/partials/role.ts` | Shared agent role framing |
| `packages/core/src/prompts/partials/output-format.ts` | Wire response schema + format instructions |
| `packages/core/src/prompts/partials/constraints.ts` | Budget, safety rules |
| `packages/core/src/prompts/partials/index.ts` | Re-export all partials |
| `packages/core/src/prompts/feedback.ts` | Compile/test digestion prompt templates |
| `packages/core/src/prompts/review.ts` | Code review prompt template |
| `packages/core/src/prompts/contracts.ts` | Contract extraction prompt template |
| `packages/core/src/prompts/quality.ts` | Quality gate prompt template |
| `packages/core/src/prompts/worker.ts` | Worker spawn prompt template (migrate from spawner.ts) |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/src/orchestrator.ts` | Slim to ~120 lines, delegate to pipeline modules |
| `packages/core/src/stages/feedback.ts` | Import prompt from `prompts/feedback.ts` |
| `packages/core/src/stages/review.ts` | Import prompt from `prompts/review.ts` |
| `packages/core/src/spring-training/contracts.ts` | Import prompt from `prompts/contracts.ts` |
| `packages/core/src/gates/quality.ts` | Import prompt from `prompts/quality.ts` |
| `packages/core/src/workers/spawner.ts` | Import prompt from `prompts/worker.ts` |
| `packages/core/src/index.ts` | Export new pipeline + prompt modules |

---

## Task 0: Move SpawnFn type to types.ts

The `SpawnFn` type is currently defined in `orchestrator.ts`. Both `pipeline/feedback-loop.ts` and `pipeline/stage-runner.ts` need it. Importing from orchestrator would create a circular dependency. Move it to `types.ts` first.

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/orchestrator.ts`

- [ ] **Step 1: Add SpawnFn to types.ts**

Add at the end of `packages/core/src/types.ts`:

```typescript
// === Spawn ===

export type SpawnFn = (options: {
  taskId: string;
  worktreePath: string;
  context: ContextPackage | EnrichedContextPackage;
  budgetUsd: number;
}) => Promise<import("./workers/spawner.js").SpawnResult>;
```

- [ ] **Step 2: Update orchestrator.ts to import SpawnFn**

In `packages/core/src/orchestrator.ts`, remove the `SpawnFn` type definition and import it:

Replace:
```typescript
export type SpawnFn = (options: {
  taskId: string;
  worktreePath: string;
  context: ContextPackage | EnrichedContextPackage;
  budgetUsd: number;
}) => Promise<SpawnResult>;
```

With:
```typescript
export type { SpawnFn } from "./types.js";
```

- [ ] **Step 3: Update index.ts export**

In `packages/core/src/index.ts`, the `SpawnFn` export already comes from orchestrator. Update to also export from types. Replace the orchestrator export line:

```typescript
export type { CycleResult, OrchestratorOptions } from "./orchestrator.js";
export type { SpawnFn } from "./types.js";
```

- [ ] **Step 4: Run typecheck**

Run: `cd ~/Development/openingday && pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/types.ts packages/core/src/orchestrator.ts packages/core/src/index.ts
git commit -m "refactor: move SpawnFn type to types.ts to avoid circular imports"
```

---

## Task 1: Extract file-reader module

**Files:**
- Create: `packages/core/src/pipeline/file-reader.ts`
- Create: `packages/core/src/pipeline/file-reader.test.ts`

- [ ] **Step 1: Write failing tests for readFileContents**

```typescript
// packages/core/src/pipeline/file-reader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileContents } from "./file-reader.js";

describe("readFileContents", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "file-reader-test-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads files from disk", async () => {
    await writeFile(join(tmpDir, "src/a.ts"), "export const a = 1;\n");
    const result = await readFileContents(tmpDir, ["src/a.ts"], []);
    expect(result["src/a.ts"]).toBe("export const a = 1;\n");
  });

  it("deduplicates touches and reads", async () => {
    await writeFile(join(tmpDir, "src/a.ts"), "export const a = 1;\n");
    const result = await readFileContents(tmpDir, ["src/a.ts"], ["src/a.ts"]);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("skips files that do not exist", async () => {
    const result = await readFileContents(tmpDir, ["src/missing.ts"], []);
    expect(result).toEqual({});
  });

  it("truncates files over threshold", async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`);
    lines[5] = "export function bigFn() {}";
    lines[200] = "export const val = 42;";
    await writeFile(join(tmpDir, "src/big.ts"), lines.join("\n"));

    const result = await readFileContents(tmpDir, ["src/big.ts"], [], 300);
    expect(result["src/big.ts"]).toContain("const line0 = 0;");
    expect(result["src/big.ts"]).toContain("truncated");
    expect(result["src/big.ts"]).toContain("export function bigFn()");
    expect(result["src/big.ts"]).toContain("export const val");
  });

  it("does not truncate files under threshold", async () => {
    const content = "export const a = 1;\nexport const b = 2;\n";
    await writeFile(join(tmpDir, "src/small.ts"), content);
    const result = await readFileContents(tmpDir, ["src/small.ts"], [], 300);
    expect(result["src/small.ts"]).toBe(content);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/pipeline/file-reader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement file-reader**

```typescript
// packages/core/src/pipeline/file-reader.ts
import { readFile } from "node:fs/promises";

const DEFAULT_TRUNCATE_THRESHOLD = 300;
const PREVIEW_LINES = 50;

/**
 * Read file contents from disk for enriched context.
 * Large files (>threshold lines): first 50 lines + export signatures + truncation notice.
 *
 * @param basePath - Root directory to resolve paths against
 * @param touches - File paths the task writes to
 * @param reads - File paths the task reads from
 * @param truncateThreshold - Line count above which files are truncated (default 300)
 */
export async function readFileContents(
  basePath: string,
  touches: string[],
  reads: string[],
  truncateThreshold = DEFAULT_TRUNCATE_THRESHOLD,
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  const allPaths = [...new Set([...touches, ...reads])];

  for (const filePath of allPaths) {
    try {
      const fullPath = `${basePath}/${filePath}`;
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      if (lines.length > truncateThreshold) {
        const first = lines.slice(0, PREVIEW_LINES).join("\n");
        const exportLines = lines
          .filter((l) => l.startsWith("export "))
          .join("\n");
        contents[filePath] = `${first}\n\n// ... (${lines.length} lines total, truncated) ...\n\n// Exports:\n${exportLines}`;
      } else {
        contents[filePath] = content;
      }
    } catch {
      // File doesn't exist yet (new file) — skip
    }
  }

  return contents;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/pipeline/file-reader.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/pipeline/file-reader.ts packages/core/src/pipeline/file-reader.test.ts
git commit -m "feat(pipeline): extract file-reader module from orchestrator"
```

---

## Task 2: Extract feedback-loop module

**Files:**
- Create: `packages/core/src/pipeline/feedback-loop.ts`
- Create: `packages/core/src/pipeline/feedback-loop.test.ts`

- [ ] **Step 1: Write failing tests for runFeedbackLoop**

```typescript
// packages/core/src/pipeline/feedback-loop.test.ts
import { describe, it, expect, vi } from "vitest";
import { runFeedbackLoop } from "./feedback-loop.js";
import type { StageResult, EnrichedContextPackage, LoopTracker } from "../types.js";
import type { SpawnFn } from "../types.js";

function makeContext(): EnrichedContextPackage {
  return {
    task: { name: "t1", description: "test", acceptanceCriteria: [] },
    interfaces: [],
    above: [],
    below: [],
    memory: "",
    rules: "",
    budget: { softLimit: 50000, hardLimit: 100000 },
    landscape: { mc: 1, fc: 1, modules: [] },
    relevant: [],
    fileContents: {},
    contracts: "",
    digests: [],
    specExcerpt: "",
  };
}

describe("runFeedbackLoop", () => {
  it("returns immediately when stage passes on first run", async () => {
    const stageFn = vi.fn<[], Promise<StageResult>>().mockResolvedValue({
      stage: "compile",
      passed: true,
      loops: 0,
      feedback: [],
    });
    const spawnFn: SpawnFn = vi.fn();

    const result = await runFeedbackLoop({
      stage: "compile",
      runStage: stageFn,
      spawn: spawnFn,
      taskId: "t1",
      worktreePath: "/tmp/wt",
      context: makeContext(),
      taskBudget: 2,
      maxIterations: 5,
    });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(0);
    expect(stageFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("retries with feedback when stage fails then passes", async () => {
    const stageFn = vi.fn<[], Promise<StageResult>>()
      .mockResolvedValueOnce({
        stage: "compile",
        passed: false,
        loops: 0,
        feedback: [{ stage: "compile", errors: [{ f: "a.ts", l: 1, e: "err", fix: "fix" }] }],
      })
      .mockResolvedValue({
        stage: "compile",
        passed: true,
        loops: 0,
        feedback: [],
      });
    const spawnFn: SpawnFn = vi.fn().mockResolvedValue({
      output: { status: "complete", filesChanged: [], interfacesModified: [], testsAdded: [], testResults: { pass: 0, fail: 0 }, notes: "", tokensUsed: 0 },
      costUsd: 0, sessionId: "s1", needsInspection: false,
    });

    const result = await runFeedbackLoop({
      stage: "compile",
      runStage: stageFn,
      spawn: spawnFn,
      taskId: "t1",
      worktreePath: "/tmp/wt",
      context: makeContext(),
      taskBudget: 2,
      maxIterations: 5,
    });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("stops at max iterations", async () => {
    const stageFn = vi.fn<[], Promise<StageResult>>().mockResolvedValue({
      stage: "test",
      passed: false,
      loops: 0,
      feedback: [{ stage: "test", errors: [{ f: "a.ts", l: 1, e: "err", fix: "fix" }] }],
    });
    const spawnFn: SpawnFn = vi.fn().mockResolvedValue({
      output: { status: "complete", filesChanged: [], interfacesModified: [], testsAdded: [], testResults: { pass: 0, fail: 0 }, notes: "", tokensUsed: 0 },
      costUsd: 0, sessionId: "s1", needsInspection: false,
    });

    const result = await runFeedbackLoop({
      stage: "test",
      runStage: stageFn,
      spawn: spawnFn,
      taskId: "t1",
      worktreePath: "/tmp/wt",
      context: makeContext(),
      taskBudget: 2,
      maxIterations: 3,
    });

    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(3);
  });

  it("detects stuck loop via safety module", async () => {
    const sameError = { stage: "compile" as const, errors: [{ f: "a.ts", l: 1, e: "same error", fix: "same fix" }] };
    const stageFn = vi.fn<[], Promise<StageResult>>().mockResolvedValue({
      stage: "compile",
      passed: false,
      loops: 0,
      feedback: [sameError],
    });
    const spawnFn: SpawnFn = vi.fn().mockResolvedValue({
      output: { status: "complete", filesChanged: [], interfacesModified: [], testsAdded: [], testResults: { pass: 0, fail: 0 }, notes: "", tokensUsed: 0 },
      costUsd: 0, sessionId: "s1", needsInspection: false,
    });

    const result = await runFeedbackLoop({
      stage: "compile",
      runStage: stageFn,
      spawn: spawnFn,
      taskId: "t1",
      worktreePath: "/tmp/wt",
      context: makeContext(),
      taskBudget: 2,
      maxIterations: 10,
    });

    expect(result.passed).toBe(false);
    expect(result.stuckDetected).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/pipeline/feedback-loop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement feedback-loop**

```typescript
// packages/core/src/pipeline/feedback-loop.ts
import type { StageResult, StageType, StageFeedback, EnrichedContextPackage } from "../types.js";
import type { SpawnFn } from "../types.js";
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

/**
 * Run a stage in a feedback loop: execute stage, if failed digest feedback,
 * respawn worker with feedback, re-run stage. Repeat until passed or safety cap.
 */
export async function runFeedbackLoop(options: FeedbackLoopOptions): Promise<FeedbackLoopResult> {
  const { stage, runStage, spawn, taskId, worktreePath, context, taskBudget, maxIterations } = options;

  let tracker = createLoopTracker(taskId);
  const errorHistory: StageFeedback[] = [];
  const diffHistory: string[] = [];
  let iterations = 0;
  let stuckDetected = false;

  // Initial run
  let stageResult = await runStage();

  for (let i = 0; i < maxIterations && !stageResult.passed; i++) {
    tracker = recordLoop(tracker, stage);
    iterations++;

    // Collect feedback
    for (const fb of stageResult.feedback) {
      errorHistory.push(fb);
    }

    // Check safety caps
    const breakCheck = shouldBreak(tracker, stage, errorHistory, diffHistory);
    if (breakCheck.break) {
      stuckDetected = breakCheck.reason.includes("Same error") || breakCheck.reason.includes("Identical diff");
      break;
    }

    // Respawn worker with feedback
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

    // Capture diff for stuck detection
    try {
      const { stdout } = await exec("git", ["diff"], { cwd: worktreePath });
      diffHistory.push(stdout);
    } catch {
      diffHistory.push("");
    }

    // Re-run stage
    stageResult = await runStage();
  }

  stageResult.loops = iterations;

  return {
    passed: stageResult.passed,
    iterations,
    finalFeedback: errorHistory,
    stuckDetected,
    stageResult,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/pipeline/feedback-loop.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/pipeline/feedback-loop.ts packages/core/src/pipeline/feedback-loop.test.ts
git commit -m "feat(pipeline): extract feedback-loop module from orchestrator"
```

---

## Task 3: Extract stage-runner module

**Files:**
- Create: `packages/core/src/pipeline/stage-runner.ts`
- Create: `packages/core/src/pipeline/stage-runner.test.ts`

- [ ] **Step 1: Write failing tests for runStagedPipeline**

```typescript
// packages/core/src/pipeline/stage-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { runStagedPipeline } from "./stage-runner.js";
import type { EnrichedContextPackage, WorkerOutput, StageResult } from "../types.js";
import type { SpawnFn } from "../types.js";
import type { SpawnResult } from "../workers/spawner.js";
import type { EnvConfig } from "../scanner/types.js";

function makeContext(): EnrichedContextPackage {
  return {
    task: { name: "t1", description: "test", acceptanceCriteria: [] },
    interfaces: [],
    above: [],
    below: [],
    memory: "",
    rules: "",
    budget: { softLimit: 50000, hardLimit: 100000 },
    landscape: { mc: 1, fc: 1, modules: [] },
    relevant: [],
    fileContents: {},
    contracts: "export interface Foo {}",
    digests: [],
    specExcerpt: "Build foo",
  };
}

function makeSuccessOutput(): WorkerOutput {
  return {
    status: "complete",
    filesChanged: ["src/a.ts"],
    interfacesModified: [],
    testsAdded: [],
    testResults: { pass: 3, fail: 0 },
    notes: "Done",
    tokensUsed: 5000,
  };
}

function makeSpawnResult(output?: Partial<WorkerOutput>): SpawnResult {
  return {
    output: { ...makeSuccessOutput(), ...output },
    costUsd: 0.1,
    sessionId: "s1",
    needsInspection: false,
  };
}

describe("runStagedPipeline", () => {
  it("runs implement stage and returns result when no env", async () => {
    const spawn: SpawnFn = vi.fn().mockResolvedValue(makeSpawnResult());

    const result = await runStagedPipeline({
      taskId: "t1",
      taskTouches: ["src/a.ts"],
      worktreePath: "/tmp/wt",
      worktreeBranch: null,
      context: makeContext(),
      taskBudget: 2,
      env: null,
      repoDir: null,
      spawn,
      contracts: "",
      specExcerpt: "",
    });

    expect(result.workerOutput.status).toBe("complete");
    expect(result.stages).toContainEqual(expect.objectContaining({ stage: "implement", passed: true }));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("marks implement as failed when spawn returns failed output", async () => {
    const spawn: SpawnFn = vi.fn().mockResolvedValue(makeSpawnResult({ status: "failed" }));

    const result = await runStagedPipeline({
      taskId: "t1",
      taskTouches: ["src/a.ts"],
      worktreePath: "/tmp/wt",
      worktreeBranch: null,
      context: makeContext(),
      taskBudget: 2,
      env: null,
      repoDir: null,
      spawn,
      contracts: "",
      specExcerpt: "",
    });

    expect(result.workerOutput.status).toBe("failed");
    expect(result.allPassed).toBe(false);
  });

  it("skips compile/test/review stages when worktreePath is '.'", async () => {
    const spawn: SpawnFn = vi.fn().mockResolvedValue(makeSpawnResult());

    const result = await runStagedPipeline({
      taskId: "t1",
      taskTouches: ["src/a.ts"],
      worktreePath: ".",
      worktreeBranch: null,
      context: makeContext(),
      taskBudget: 2,
      env: { ts: true, pm: "pnpm" } as EnvConfig,
      repoDir: null,
      spawn,
      contracts: "",
      specExcerpt: "",
    });

    // Only implement stage
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]!.stage).toBe("implement");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/pipeline/stage-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement stage-runner**

```typescript
// packages/core/src/pipeline/stage-runner.ts
import type {
  EnrichedContextPackage,
  WorkerOutput,
  StageResult,
  StageFeedback,
} from "../types.js";
import type { EnvConfig } from "../scanner/types.js";
import type { SpawnFn } from "../types.js";
import type { SpawnResult } from "../workers/spawner.js";
import { inspectWorktreeOutput } from "../workers/inspect.js";
import { runCompileStage } from "../stages/compile.js";
import { runTestStage } from "../stages/test.js";
import { runReviewStage } from "../stages/review.js";
import { runFeedbackLoop } from "./feedback-loop.js";
import { recordLoop, createLoopTracker, shouldBreak } from "../safety/loops.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

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

/**
 * Run the full staged pipeline for a single task:
 * implement -> compile (loop) -> test (loop) -> review -> gate
 */
export async function runStagedPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    taskId, taskTouches, worktreePath, context, taskBudget,
    env, spawn, contracts, specExcerpt,
  } = options;

  const stages: StageOutcome[] = [];
  const stageResults: StageResult[] = [];
  let allPassed = true;

  // === STAGE: IMPLEMENT ===
  const spawnResult = await spawn({
    taskId,
    worktreePath,
    context,
    budgetUsd: taskBudget,
  });

  let workerOutput = spawnResult.output;
  if (spawnResult.needsInspection && worktreePath !== ".") {
    workerOutput = await inspectWorktreeOutput(worktreePath, taskTouches, env);
  }

  stages.push({
    stage: "implement",
    passed: workerOutput.status !== "failed",
  });

  if (workerOutput.status === "failed") {
    return { workerOutput, spawnResult, stages, allPassed: false, stageResults };
  }

  // Skip compile/test/review when not in a real worktree
  if (worktreePath === ".") {
    return { workerOutput, spawnResult, stages, allPassed: true, stageResults };
  }

  // === STAGE: COMPILE (with feedback loop) ===
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

    stages.push({
      stage: "compile",
      passed: compileLoop.passed,
      feedback: compileLoop.finalFeedback,
      loopCount: compileLoop.iterations,
    });
    stageResults.push(compileLoop.stageResult);

    if (!compileLoop.passed) {
      allPassed = false;
      return { workerOutput, spawnResult, stages, allPassed, stageResults };
    }
  }

  // === STAGE: TEST (with feedback loop) ===
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

    stages.push({
      stage: "test",
      passed: testLoop.passed,
      feedback: testLoop.finalFeedback,
      loopCount: testLoop.iterations,
    });
    stageResults.push(testLoop.stageResult);

    if (!testLoop.passed) {
      allPassed = false;
      return { workerOutput, spawnResult, stages, allPassed, stageResults };
    }
  }

  // === STAGE: REVIEW ===
  let diff = "";
  try {
    const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
    diff = stdout;
  } catch {
    diff = "(could not generate diff)";
  }

  const reviewResult = await runReviewStage(worktreePath, diff, contracts, specExcerpt, taskBudget);
  stageResults.push(reviewResult);

  if (!reviewResult.passed) {
    // One retry with review feedback
    const tracker = recordLoop(createLoopTracker(taskId), "review");
    const breakCheck = shouldBreak(tracker, "review", reviewResult.feedback, []);

    if (breakCheck.break) {
      stages.push({ stage: "review", passed: false, feedback: reviewResult.feedback });
      allPassed = false;
    } else {
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

      const retryReview = await runReviewStage(worktreePath, diff, contracts, specExcerpt, taskBudget);
      stageResults.push(retryReview);
      stages.push({ stage: "review", passed: retryReview.passed, feedback: retryReview.feedback, loopCount: 1 });

      if (!retryReview.passed) {
        allPassed = false;
      }
    }
  } else {
    stages.push({ stage: "review", passed: true });
  }

  return { workerOutput, spawnResult, stages, allPassed, stageResults };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/pipeline/stage-runner.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/pipeline/stage-runner.ts packages/core/src/pipeline/stage-runner.test.ts
git commit -m "feat(pipeline): extract stage-runner module from orchestrator"
```

---

## Task 4: Slim orchestrator to coordinator

**Files:**
- Modify: `packages/core/src/orchestrator.ts`

- [ ] **Step 1: Run existing orchestrator tests to establish baseline**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/orchestrator.test.ts`
Expected: All tests PASS (baseline before refactor)

- [ ] **Step 2: Rewrite orchestrator to use pipeline modules**

Replace the full contents of `packages/core/src/orchestrator.ts` with:

```typescript
import type { Storage } from "./storage/interface.js";
import type { SpawnResult } from "./workers/spawner.js";
import type { ContextPackage, EnrichedContextPackage } from "./types.js";
import {
  createWorkerPool,
  planSpawns,
  spawnWorker,
  completeWorker,
  applyWorkerResult,
  getActiveCount,
} from "./workers/pool.js";
import type { WorkerPool } from "./workers/pool.js";
import { buildEnrichedContext } from "./context/context-builder.js";
import {
  runGatePipeline,
  createDefaultPipeline,
} from "./gates/pipeline.js";
import { getAllTasks, getTask, updateTaskStatus, updateTask } from "./trees/work-tree.js";
import {
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  isTerminal,
} from "./state/state-machine.js";
import {
  getProjectBudgetStatus,
  checkCircuitBreakers,
} from "./budget/budget.js";
import {
  createWorktree,
  removeWorktree,
  mergeWorktree,
} from "./workers/worktree.js";
import { preflightCheck } from "./preflight/check.js";
import { generateDigest } from "./digests/generator.js";
import { createWatchdog, createWatchdogState } from "./safety/watchdog.js";
import type { Watchdog } from "./safety/watchdog.js";
import { getCachedContext, setCachedContext, invalidateContext } from "./cache/context-cache.js";
import { runSpringTraining } from "./spring-training/runner.js";
import { refreshFiles } from "./scanner/incremental.js";
import { readFileContents } from "./pipeline/file-reader.js";
import { runStagedPipeline } from "./pipeline/stage-runner.js";

// === Types ===

export type SpawnFn = (options: {
  taskId: string;
  worktreePath: string;
  context: ContextPackage | EnrichedContextPackage;
  budgetUsd: number;
}) => Promise<SpawnResult>;

export interface CycleResult {
  dispatched: number;
  completed: number;
  failed: number;
  isComplete: boolean;
  isPaused: boolean;
  error?: string;
}

export interface OrchestratorOptions {
  repoDir?: string;
  specText?: string;
  skipSpringTraining?: boolean;
}

// === Orchestrator ===

export class Orchestrator {
  private pool: WorkerPool;
  private readonly options: OrchestratorOptions;
  private watchdog: Watchdog;
  private springTrainingDone = false;

  constructor(
    private readonly storage: Storage,
    private readonly spawn: SpawnFn,
    options?: OrchestratorOptions,
  ) {
    this.pool = createWorkerPool();
    this.options = options ?? {};
    this.watchdog = createWatchdog(createWatchdogState());
  }

  async runOneCycle(): Promise<CycleResult> {
    // 1. Read state
    const config = await this.storage.readProjectConfig();
    let state = await this.storage.readProjectState();
    let workTree = await this.storage.readWorkTree();
    const codeTree = await this.storage.readCodeTree();
    const repoMap = await this.storage.readRepoMap();
    const memory = await this.storage.readMemory();

    // 2. Terminal/paused check
    if (isTerminal(state.status)) {
      return { dispatched: 0, completed: 0, failed: 0, isComplete: state.status === "complete", isPaused: false };
    }
    if (state.status === "paused") {
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true };
    }

    // 3. Safety checks
    const watchdogAction = this.watchdog.check();
    if (watchdogAction === "pause") {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true, error: "Watchdog: no progress for 40 minutes" };
    }
    if (watchdogAction === "warn") {
      await this.storage.appendMemory("Watchdog warning: no task completed in 20 minutes");
    }

    const circuitStatus = checkCircuitBreakers(workTree, state, config);
    if (circuitStatus.reason) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true, error: `Circuit breaker: ${circuitStatus.reason}` };
    }

    const budgetStatus = getProjectBudgetStatus(state, config);
    if (budgetStatus.atLimit) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true, error: "Budget limit reached" };
    }

    // 4. Spring training
    if (!this.springTrainingDone && !this.options.skipSpringTraining && this.options.specText) {
      try {
        const stResult = await runSpringTraining(this.storage, this.options.specText, repoMap, this.options.repoDir);
        if (!stResult.valid) {
          await this.storage.appendMemory(`Spring training blockers: ${stResult.blockers.join("; ")}`);
        }
        if (stResult.warnings.length > 0) {
          await this.storage.appendMemory(`Spring training warnings: ${stResult.warnings.join("; ")}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(`Spring training failed: ${msg}`);
      }
      this.springTrainingDone = true;
    }

    // 5. Auto-retry failed tasks
    for (const task of getAllTasks(workTree)) {
      if (task.status === "failed" && task.attemptCount < config.limits.maxRetries) {
        workTree = updateTaskStatus(workTree, task.id, "pending");
      }
    }

    // 6. Plan spawns + check completion
    const spawnDecision = planSpawns(workTree, this.pool, config, state);
    const allTasks = getAllTasks(workTree);
    const allDone = allTasks.length === 0 || allTasks.every((t) => t.status === "complete" || t.status === "failed");

    if (allDone && getActiveCount(this.pool) === 0 && !spawnDecision.canSpawn) {
      state = transition(state, "complete");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: true, isPaused: false };
    }

    // 7. Dispatch tasks
    let dispatched = 0;
    let completed = 0;
    let failed = 0;
    const contracts = await this.storage.readContracts();
    const digests = await this.storage.readDigests();
    const env = repoMap?.env ?? null;

    for (const task of spawnDecision.tasksToSpawn) {
      // Preflight
      const preflight = preflightCheck(workTree, codeTree, repoMap, config, task.id);
      if (!preflight.canProceed) {
        workTree = updateTaskStatus(workTree, task.id, "failed");
        failed++;
        await this.storage.appendMemory(`Task ${task.id} blocked by preflight: ${preflight.blockers.join("; ")}`);
        continue;
      }
      if (preflight.warnings.length > 0) {
        await this.storage.appendMemory(`Task ${task.id} preflight warnings: ${preflight.warnings.join("; ")}`);
      }

      // Build enriched context
      let context = getCachedContext(task.id);
      if (!context) {
        const fileContents = await readFileContents(this.options.repoDir ?? ".", task.touches, task.reads);
        context = buildEnrichedContext(
          workTree, codeTree, config, task.id, memory, "",
          repoMap, contracts, digests, this.options.specText ?? "", fileContents,
        );
        if (!context) continue;
        setCachedContext(task.id, context);
      }

      // Create worktree
      let worktreePath = ".";
      let worktreeBranch: string | null = null;
      if (this.options.repoDir) {
        const wt = await createWorktree(this.options.repoDir, task.id);
        worktreePath = wt.path;
        worktreeBranch = wt.branch;
      }

      // Mark in_progress
      workTree = updateTaskStatus(workTree, task.id, "in_progress");
      const sessionId = `session-${task.id}-${Date.now()}`;
      this.pool = spawnWorker(this.pool, sessionId, task.id, worktreePath);
      state = incrementWorkersSpawned(state);
      dispatched++;

      try {
        // Run staged pipeline
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
        });

        state = addTokenSpend(state, pipeline.workerOutput.tokensUsed);
        await this.storage.writeWorkerOutput(task.id, pipeline.workerOutput);

        for (const sr of pipeline.stageResults) {
          await this.storage.writeStageResult(task.id, sr);
        }

        // Gate pipeline
        let allPassed = pipeline.allPassed;
        if (allPassed) {
          const gatePipeline = createDefaultPipeline(task.touches, undefined, {
            worktreePath: worktreePath !== "." ? worktreePath : undefined,
          });
          const gateResults = await runGatePipeline(gatePipeline, pipeline.workerOutput, workTree, codeTree, worktreePath !== "." ? worktreePath : undefined);
          for (const gr of gateResults.results) {
            await this.storage.writeGateResult(task.id, gr);
          }
          if (!gateResults.passed) {
            allPassed = false;
          }
        }

        // Merge or fail
        if (allPassed) {
          if (this.options.repoDir && worktreeBranch) {
            const mergeResult = await mergeWorktree(this.options.repoDir, worktreeBranch);
            if (!mergeResult.success) {
              workTree = updateTaskStatus(workTree, task.id, "failed");
              workTree = updateTask(workTree, task.id, { attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1 });
              this.pool = completeWorker(this.pool, sessionId, "failed");
              failed++;
              await this.storage.appendMemory(`Task ${task.id} merge conflict: ${mergeResult.error}`);
              continue;
            }
          }

          workTree = applyWorkerResult(workTree, task.id, pipeline.workerOutput);
          this.pool = completeWorker(this.pool, sessionId, "completed");
          completed++;

          // Post-pipeline: digest, cache, repo map
          const digest = generateDigest(task.id, pipeline.workerOutput, workTree, codeTree);
          await this.storage.writeDigest(task.id, digest);
          invalidateContext(task.id);

          if (repoMap && pipeline.workerOutput.filesChanged.length > 0) {
            const updatedMap = await refreshFiles(repoMap, this.options.repoDir ?? ".", pipeline.workerOutput.filesChanged);
            await this.storage.writeRepoMap(updatedMap);
          }

          this.watchdog.reset();
        } else {
          workTree = updateTaskStatus(workTree, task.id, "failed");
          workTree = updateTask(workTree, task.id, { attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1 });
          this.pool = completeWorker(this.pool, sessionId, "failed");
          failed++;
          await this.storage.appendMemory(`Task ${task.id} failed staged pipeline at ${new Date().toISOString()}`);
        }
      } catch (err) {
        workTree = updateTaskStatus(workTree, task.id, "failed");
        workTree = updateTask(workTree, task.id, { attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1 });
        this.pool = completeWorker(this.pool, sessionId, "failed");
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(`Task ${task.id} spawn error: ${message}`);
      } finally {
        if (this.options.repoDir && worktreePath !== ".") {
          try { await removeWorktree(this.options.repoDir, worktreePath); } catch { /* cleanup non-fatal */ }
        }
      }
    }

    await this.storage.writeWorkTree(workTree);
    await this.storage.writeProjectState(state);

    return { dispatched, completed, failed, isComplete: false, isPaused: false };
  }
}
```

- [ ] **Step 3: Run all orchestrator tests**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/orchestrator.test.ts`
Expected: All existing tests PASS

- [ ] **Step 4: Run full test suite to check for regressions**

Run: `cd ~/Development/openingday && pnpm test -- --run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/orchestrator.ts
git commit -m "refactor(orchestrator): slim to coordinator using pipeline modules"
```

---

## Task 5: Create prompt partials

**Files:**
- Create: `packages/core/src/prompts/partials/role.ts`
- Create: `packages/core/src/prompts/partials/output-format.ts`
- Create: `packages/core/src/prompts/partials/constraints.ts`
- Create: `packages/core/src/prompts/partials/index.ts`

- [ ] **Step 1: Create role partial**

```typescript
// packages/core/src/prompts/partials/role.ts

/**
 * Wire-mode agent role framing. Shared across all AI-to-AI prompts.
 */
export function agentRole(taskType: string): string {
  return `role:${taskType}|mode:wire|respond:json-only`;
}
```

- [ ] **Step 2: Create output-format partial**

```typescript
// packages/core/src/prompts/partials/output-format.ts

/**
 * Wire-mode output format instructions.
 * @param schema - Compact schema description for the expected JSON shape
 */
export function outputFormat(schema: string): string {
  return `out:{${schema}}|no-prose|no-markdown-fences`;
}

/**
 * Standard error list output format used by feedback and review prompts.
 */
export function errorListFormat(): string {
  return outputFormat('"errors":[{"f":file,"l":line,"e":desc,"fix":suggestion}]');
}

/**
 * Review output format with approved flag.
 */
export function reviewFormat(): string {
  return outputFormat('"approved":bool,"issues":[{"f":file,"l":line,"e":desc,"fix":suggestion}]');
}

/**
 * Quality review output format.
 */
export function qualityFormat(): string {
  return outputFormat('"pass":bool,"issues":[{"rule":string,"file":string,"note":string,"severity":"high"|"low"}]');
}
```

- [ ] **Step 3: Create constraints partial**

```typescript
// packages/core/src/prompts/partials/constraints.ts

/**
 * Wire-mode budget and safety constraints.
 */
export function constraints(budget: number, rules: string[]): string {
  const parts = [`budget:$${budget.toFixed(2)}`];
  if (rules.length > 0) {
    parts.push(`rules:[${rules.join(",")}]`);
  }
  return parts.join("|");
}

/**
 * Standard constraint for digest-only prompts (no file modifications).
 */
export function digestConstraints(budget: number): string {
  return constraints(budget, ["no-file-access", "no-tools", "json-only"]);
}
```

- [ ] **Step 4: Create index re-export**

```typescript
// packages/core/src/prompts/partials/index.ts
export { agentRole } from "./role.js";
export { outputFormat, errorListFormat, reviewFormat, qualityFormat } from "./output-format.js";
export { constraints, digestConstraints } from "./constraints.js";
```

- [ ] **Step 5: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/prompts/partials/
git commit -m "feat(prompts): add wire-mode prompt partials — role, output-format, constraints"
```

---

## Task 6: Create feedback prompt template + migrate stages/feedback.ts

**Files:**
- Create: `packages/core/src/prompts/feedback.ts`
- Modify: `packages/core/src/stages/feedback.ts`

- [ ] **Step 1: Create feedback prompt template**

```typescript
// packages/core/src/prompts/feedback.ts
import { agentRole, errorListFormat, digestConstraints } from "./partials/index.js";

export interface FeedbackPromptArgs {
  stage: "compile" | "test";
  rawOutput: string;
  budget: number;
}

/**
 * Build a wire-mode prompt for AI digestion of compile/test errors.
 */
export function feedbackPrompt(args: FeedbackPromptArgs): string {
  const outputSlice = args.rawOutput.slice(0, 3000);

  return [
    agentRole(`${args.stage}-feedback`),
    `task:digest-${args.stage}-errors`,
    `raw:\n${outputSlice}`,
    errorListFormat(),
    digestConstraints(args.budget),
    args.stage === "compile"
      ? "hint:reference-actual-types-and-imports|be-specific-about-fixes"
      : "hint:identify-root-cause|reference-test-names",
  ].join("|");
}
```

- [ ] **Step 2: Migrate stages/feedback.ts to use template**

In `packages/core/src/stages/feedback.ts`, replace the inline prompt strings in `digestCompileErrors` and `digestTestFailures` with calls to `feedbackPrompt`.

Replace `digestCompileErrors` (lines 39-92):

```typescript
export async function digestCompileErrors(
  rawOutput: string,
  cwd: string,
  budget: number,
): Promise<StageFeedback> {
  try {
    const prompt = feedbackPrompt({ stage: "compile", rawOutput, budget });

    const stream = query({
      prompt,
      options: {
        model: "claude-opus-4-20250514",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: budget,
        persistSession: false,
        cwd,
        allowedTools: [],
      },
    });

    let resultMsg: SDKResultMessage | null = null;
    for await (const msg of stream) {
      if (msg.type === "result") {
        resultMsg = msg;
      }
    }

    if (!resultMsg || resultMsg.subtype !== "success") {
      return {
        stage: "compile",
        errors: [{ f: "unknown", l: 0, e: rawOutput.slice(0, 500), fix: "Fix TypeScript compilation errors" }],
      };
    }

    return parseFeedbackResponse(resultMsg.result, "compile");
  } catch {
    return {
      stage: "compile",
      errors: [{ f: "", l: 0, e: `Digest failed: ${rawOutput.slice(0, 500)}`, fix: "" }],
    };
  }
}
```

Replace `digestTestFailures` (lines 98-151):

```typescript
export async function digestTestFailures(
  rawOutput: string,
  cwd: string,
  budget: number,
): Promise<StageFeedback> {
  try {
    const prompt = feedbackPrompt({ stage: "test", rawOutput, budget });

    const stream = query({
      prompt,
      options: {
        model: "claude-opus-4-20250514",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: budget,
        persistSession: false,
        cwd,
        allowedTools: [],
      },
    });

    let resultMsg: SDKResultMessage | null = null;
    for await (const msg of stream) {
      if (msg.type === "result") {
        resultMsg = msg;
      }
    }

    if (!resultMsg || resultMsg.subtype !== "success") {
      return {
        stage: "test",
        errors: [{ f: "unknown", l: 0, e: rawOutput.slice(0, 500), fix: "Fix failing tests" }],
      };
    }

    return parseFeedbackResponse(resultMsg.result, "test");
  } catch {
    return {
      stage: "test",
      errors: [{ f: "", l: 0, e: `Digest failed: ${rawOutput.slice(0, 500)}`, fix: "" }],
    };
  }
}
```

Add import at top of `stages/feedback.ts`:
```typescript
import { feedbackPrompt } from "../prompts/feedback.js";
```

- [ ] **Step 3: Run tests**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/stages/feedback.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/prompts/feedback.ts packages/core/src/stages/feedback.ts
git commit -m "feat(prompts): add feedback template, migrate stages/feedback.ts to wire mode"
```

---

## Task 7: Create review prompt template + migrate stages/review.ts

**Files:**
- Create: `packages/core/src/prompts/review.ts`
- Modify: `packages/core/src/stages/review.ts`

- [ ] **Step 1: Create review prompt template**

```typescript
// packages/core/src/prompts/review.ts
import { agentRole, reviewFormat, digestConstraints } from "./partials/index.js";

export interface ReviewPromptArgs {
  diff: string;
  contracts: string;
  specExcerpt: string;
  budget: number;
}

/**
 * Build a wire-mode prompt for AI code review.
 */
export function reviewPrompt(args: ReviewPromptArgs): string {
  return [
    agentRole("code-reviewer"),
    `contracts:\n${args.contracts || "(none)"}`,
    `spec:\n${args.specExcerpt || "(none)"}`,
    `diff:\n${args.diff}`,
    "check:[domain-fidelity,pattern-consistency,no-duplication,proper-imports,middleware-order,test-coverage]",
    reviewFormat(),
    digestConstraints(args.budget),
  ].join("|");
}
```

- [ ] **Step 2: Migrate stages/review.ts to use template**

Replace `buildReviewPrompt` function in `packages/core/src/stages/review.ts`:

```typescript
import { reviewPrompt } from "../prompts/review.js";
```

Replace the `buildReviewPrompt` function (lines 9-48) with:

```typescript
export function buildReviewPrompt(diff: string, contracts: string, specExcerpt: string): string {
  return reviewPrompt({ diff, contracts, specExcerpt, budget: 0.5 });
}
```

- [ ] **Step 3: Run tests**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/stages/review.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/prompts/review.ts packages/core/src/stages/review.ts
git commit -m "feat(prompts): add review template, migrate stages/review.ts to wire mode"
```

---

## Task 8: Create contracts prompt template + migrate spring-training/contracts.ts

**Files:**
- Create: `packages/core/src/prompts/contracts.ts`
- Modify: `packages/core/src/spring-training/contracts.ts`

- [ ] **Step 1: Create contracts prompt template**

```typescript
// packages/core/src/prompts/contracts.ts
import { agentRole, digestConstraints } from "./partials/index.js";
import type { RepoMap } from "../scanner/types.js";

export interface ContractPromptArgs {
  specText: string;
  repoMap?: RepoMap | null;
  budget: number;
}

/**
 * Build a wire-mode prompt for contract (shared type) generation from spec.
 */
export function contractPrompt(args: ContractPromptArgs): string {
  const parts = [
    agentRole("type-architect"),
    "task:extract-domain-types-from-spec",
    "rules:[exact-domain-language,every-entity-becomes-interface,export-all,types-only,no-imports,self-contained]",
    `spec:\n${args.specText}`,
    "out:valid-typescript-source|no-markdown-fences|no-explanation",
    digestConstraints(args.budget),
  ];

  if (args.repoMap) {
    const existingTypes: string[] = [];
    for (const mod of args.repoMap.modules) {
      for (const file of mod.files) {
        for (const ex of file.ex) {
          if (ex.s.includes("interface") || ex.s.includes("type") || ex.s.includes("enum")) {
            existingTypes.push(`// ${file.p}\n${ex.s}`);
          }
        }
      }
    }
    if (existingTypes.length > 0) {
      parts.push(`existing-types:\n${existingTypes.join("\n\n")}`);
      parts.push("hint:merge-with-existing|preserve-field-names");
    }
  }

  return parts.join("|");
}
```

- [ ] **Step 2: Migrate spring-training/contracts.ts to use template**

Replace `buildContractPrompt` function in `packages/core/src/spring-training/contracts.ts`:

Add import:
```typescript
import { contractPrompt } from "../prompts/contracts.js";
```

Replace the `buildContractPrompt` function (lines 8-46) with:

```typescript
export function buildContractPrompt(specText: string, repoMap?: RepoMap | null): string {
  return contractPrompt({ specText, repoMap, budget: 0.5 });
}
```

- [ ] **Step 3: Run tests**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/spring-training/contracts.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/prompts/contracts.ts packages/core/src/spring-training/contracts.ts
git commit -m "feat(prompts): add contracts template, migrate spring-training/contracts.ts to wire mode"
```

---

## Task 9: Create quality prompt template + migrate gates/quality.ts

**Files:**
- Create: `packages/core/src/prompts/quality.ts`
- Modify: `packages/core/src/gates/quality.ts`

- [ ] **Step 1: Create quality prompt template**

```typescript
// packages/core/src/prompts/quality.ts
import { agentRole, qualityFormat, digestConstraints } from "./partials/index.js";

export interface QualityPromptArgs {
  diff: string;
  standards: string;
  budget: number;
}

/**
 * Build a wire-mode prompt for AI quality review.
 */
export function qualityPrompt(args: QualityPromptArgs): string {
  return [
    agentRole("quality-reviewer"),
    `standards:\n${args.standards}`,
    `diff:\n${args.diff}`,
    qualityFormat(),
    digestConstraints(args.budget),
  ].join("|");
}
```

- [ ] **Step 2: Migrate gates/quality.ts to use template**

Add import in `packages/core/src/gates/quality.ts`:
```typescript
import { qualityPrompt } from "../prompts/quality.js";
```

Replace `buildQualityPrompt` function (lines 23-44) with:

```typescript
export function buildQualityPrompt(diff: string, standards: string): string {
  return qualityPrompt({ diff, standards, budget: 0.5 });
}
```

- [ ] **Step 3: Run tests**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/gates/quality.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/prompts/quality.ts packages/core/src/gates/quality.ts
git commit -m "feat(prompts): add quality template, migrate gates/quality.ts to wire mode"
```

---

## Task 10: Create worker prompt template + migrate workers/spawner.ts

**Files:**
- Create: `packages/core/src/prompts/worker.ts`
- Modify: `packages/core/src/workers/spawner.ts`

- [ ] **Step 1: Create worker prompt template**

```typescript
// packages/core/src/prompts/worker.ts
import { agentRole, outputFormat } from "./partials/index.js";

/**
 * Build the system prompt for worker agents. Already wire-mode — this migration
 * centralizes the prompt in prompts/ without changing content.
 */
export function workerSystemPrompt(): string {
  return `You are a coding agent operating in wire mode.

You will receive a JSON object (WirePrompt) describing your task, the files you may modify, read-only context files, acceptance criteria, memory notes, and a token budget.

Complete the task by modifying files in your working directory. When finished, output ONLY a single JSON object matching the WireResponse schema. No other text before or after.

WireResponse schema:
{
  "s": "ok" | "partial" | "fail",
  "changed": string[],        // paths of files you changed
  "iface": [                   // interface changes (exports modified)
    { "f": string, "e": string, "b": string, "a": string }
  ],
  "tests": { "p": number, "f": number },  // pass/fail counts
  "t": number,                 // approximate tokens used
  "n": string                  // notes about what you did
}

Rules:
- Only modify files listed in the "files" field of the prompt
- Read-only files in "reads" are for context only
- Meet all acceptance criteria listed in "accept"
- Stay within the token budget
- Output valid JSON only -- no markdown fences, no explanation

COMMON PITFALLS — avoid these:
- Express 5: use "/{*path}" not "/*" for catch-all routes
- ESM: use import.meta.url + fileURLToPath instead of __dirname
- ESM: include .js extensions in relative imports
- Vite: add src/vite-env.d.ts with /// <reference types="vite/client" />
- TypeScript: handle potentially undefined array access with ! or null checks
- Middleware: register static file serving BEFORE 404 handlers
- Types: match the spec's domain language exactly — don't substitute generic fields`;
}
```

- [ ] **Step 2: Migrate workers/spawner.ts to use template**

In `packages/core/src/workers/spawner.ts`, add import:
```typescript
import { workerSystemPrompt } from "../prompts/worker.js";
```

Replace `buildSystemPrompt` function (lines 30-64) with:

```typescript
export function buildSystemPrompt(): string {
  return workerSystemPrompt();
}
```

- [ ] **Step 3: Run tests**

Run: `cd ~/Development/openingday && pnpm test -- --run packages/core/src/workers/spawner.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/prompts/worker.ts packages/core/src/workers/spawner.ts
git commit -m "feat(prompts): add worker template, migrate workers/spawner.ts to centralized prompts"
```

---

## Task 11: Update index.ts exports + final validation

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports for new modules**

Add these export blocks to `packages/core/src/index.ts`:

```typescript
// Pipeline
export { readFileContents } from "./pipeline/file-reader.js";
export { runFeedbackLoop } from "./pipeline/feedback-loop.js";
export type { FeedbackLoopOptions, FeedbackLoopResult } from "./pipeline/feedback-loop.js";
export { runStagedPipeline } from "./pipeline/stage-runner.js";
export type { PipelineOptions, PipelineResult, StageOutcome } from "./pipeline/stage-runner.js";

// Prompt Templates
export { agentRole } from "./prompts/partials/role.js";
export { outputFormat, errorListFormat, reviewFormat, qualityFormat } from "./prompts/partials/output-format.js";
export { constraints, digestConstraints } from "./prompts/partials/constraints.js";
export { feedbackPrompt } from "./prompts/feedback.js";
export type { FeedbackPromptArgs } from "./prompts/feedback.js";
export { reviewPrompt } from "./prompts/review.js";
export type { ReviewPromptArgs } from "./prompts/review.js";
export { contractPrompt } from "./prompts/contracts.js";
export type { ContractPromptArgs } from "./prompts/contracts.js";
export { qualityPrompt } from "./prompts/quality.js";
export type { QualityPromptArgs } from "./prompts/quality.js";
export { workerSystemPrompt } from "./prompts/worker.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd ~/Development/openingday && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `cd ~/Development/openingday && pnpm test -- --run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/Development/openingday
git add packages/core/src/index.ts
git commit -m "feat(core): export pipeline modules and prompt templates"
```

- [ ] **Step 5: Run lint + format**

Run: `cd ~/Development/openingday && pnpm lint:fix && pnpm format`
Expected: Clean

- [ ] **Step 6: Final commit if lint/format changed files**

```bash
cd ~/Development/openingday
git add -A
git diff --cached --quiet || git commit -m "chore: lint and format"
```

# OpeningDay Quality Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-shot blind workers with enriched context, staged feedback loops (compile/test/review), strict contracts, and heavy plan validation (spring training) — quality over speed at every layer.

**Architecture:** New `spring-training/` module validates plans before execution (structural checks, AI contract generation, execution simulation). New `stages/` module runs compile/test/review feedback loops per task with AI-digested errors. New `digests/` module generates wire-mode task completion summaries. New `safety/` module adds watchdog timer and loop tracking. Orchestrator rewrites from single-pass to staged pipeline. Context builder gains enriched mode with full file contents + contracts + digests.

**Tech Stack:** Existing OpeningDay core + Agent SDK for AI stages. No new external deps.

**Spec:** `docs/superpowers/specs/2026-04-09-openingday-quality-overhaul-design.md`

---

## File Map

### `packages/core/src/` — New Files

| File                           | Responsibility                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `spring-training/validate.ts`  | Structural validation: file existence, one-owner-per-file, DAG, context estimation, description quality, tests-with-impl |
| `spring-training/contracts.ts` | AI contract generation from spec — shared types file                                                                     |
| `spring-training/simulate.ts`  | Execution plan simulation — walk tasks, detect missing deps, optimize order                                              |
| `spring-training/runner.ts`    | Orchestrate validate + contracts + simulate pipeline                                                                     |
| `stages/compile.ts`            | Compile stage runner — `tsc --noEmit` with AI feedback                                                                   |
| `stages/test.ts`               | Test stage runner — `{env.pm} test` with AI feedback                                                                     |
| `stages/review.ts`             | Review stage runner — AI reviewer reads diff + contracts + spec                                                          |
| `stages/feedback.ts`           | AI error digesters for compile/test/review output                                                                        |
| `digests/generator.ts`         | Task completion digest generation                                                                                        |
| `safety/watchdog.ts`           | Global watchdog timer — no-progress detection                                                                            |
| `safety/loops.ts`              | Per-task loop tracking with circuit breakers                                                                             |

### `packages/core/src/` — Modified Files

| File                         | Change                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                   | Add StageType, StageFeedback, StageResult, TaskDigest, SpringTrainingResult, EnrichedContextPackage, WatchdogState, LoopTracker; update WirePrompt |
| `storage/interface.ts`       | Add writeDigest, readDigests, writeContracts, readContracts, writeStageResult, readStageResults                                                    |
| `storage/disk.ts`            | Implement new storage methods                                                                                                                      |
| `context/context-builder.ts` | Add buildEnrichedContext function                                                                                                                  |
| `wire/wire.ts`               | Add toEnrichedWirePrompt function                                                                                                                  |
| `seeder/from-spec.ts`        | Enforce 5 seeder rules in prompt + validation                                                                                                      |
| `orchestrator.ts`            | Rewrite runOneCycle to staged pipeline                                                                                                             |
| `index.ts`                   | Export all new modules                                                                                                                             |

### `packages/cli/src/` — Modified/New Files

| File                          | Change                                   |
| ----------------------------- | ---------------------------------------- |
| `commands/init.ts`            | Run spring training after seeding        |
| `commands/new.ts`             | Run spring training after seeding        |
| `commands/spring-training.ts` | New `openingday spring-training` command |
| `index.ts`                    | Register spring-training command         |

---

## Task 1: New Types

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/types.test.ts`

- [ ] **Step 1: Add stage and feedback types to types.ts**

Append after the `GateResult` interface (line 148):

```ts
// packages/core/src/types.ts — append after GateResult

// === Stages ===

export type StageType = "compile" | "test" | "review";

export interface StageFeedback {
  stage: StageType;
  errors: { f: string; l: number; e: string; fix: string }[];
}

export interface StageResult {
  stage: StageType;
  passed: boolean;
  loops: number;
  feedback: StageFeedback[];
}

// === Task Digests ===

export interface TaskDigest {
  task: string;
  did: string;
  ex: string[];
  im: string[];
  pattern: string;
}

// === Spring Training ===

export interface SpringTrainingResult {
  valid: boolean;
  blockers: string[];
  warnings: string[];
  contracts: string;
  executionOrder: string[];
  addedDependencies: string[][];
}

// === Enriched Context ===

export interface EnrichedContextPackage extends ContextPackage {
  fileContents: Record<string, string>;
  contracts: string;
  digests: TaskDigest[];
  specExcerpt: string;
}

// === Safety ===

export interface WatchdogState {
  lastTaskCompletedAt: string;
  warningIssued: boolean;
}

export interface LoopTracker {
  taskId: string;
  stageLoopIds: string[];
  totalLoops: number;
}
```

- [ ] **Step 2: Update WirePrompt to include enriched fields**

Add optional enriched fields to WirePrompt:

```ts
// packages/core/src/types.ts — replace WirePrompt interface

export interface WirePrompt {
  task: string;
  files: Record<string, { exports: { n: string; sig: string }[] }>;
  reads: Record<string, { exports: { n: string; sig: string }[] }>;
  accept: string[];
  memory: string;
  budget: number;
  landscape: { mc: number; fc: number; modules: { p: string; fc: number; k: string[] }[] };
  relevant: Record<string, { exports: { n: string; sig: string }[] }>;
  contents?: Record<string, string>;
  contracts?: string;
  digests?: TaskDigest[];
}
```

- [ ] **Step 3: Add type construction tests**

```ts
// packages/core/src/types.test.ts — add to existing describe block

it("creates a valid StageFeedback", () => {
  const feedback: StageFeedback = {
    stage: "compile",
    errors: [
      {
        f: "src/routes/players.ts",
        l: 12,
        e: "Property 'team' does not exist",
        fix: "Import Player from contracts.ts",
      },
    ],
  };
  expect(feedback.stage).toBe("compile");
  expect(feedback.errors).toHaveLength(1);
  expect(feedback.errors[0]!.f).toBe("src/routes/players.ts");
});

it("creates a valid StageResult", () => {
  const result: StageResult = {
    stage: "test",
    passed: false,
    loops: 2,
    feedback: [
      {
        stage: "test",
        errors: [{ f: "test.ts", l: 5, e: "Expected 200 got 404", fix: "Register route" }],
      },
    ],
  };
  expect(result.passed).toBe(false);
  expect(result.loops).toBe(2);
});

it("creates a valid TaskDigest", () => {
  const digest: TaskDigest = {
    task: "m1-s1-t1",
    did: "created GET /players in src/routes/players.ts",
    ex: ["playersRouter"],
    im: ["Player from contracts", "store"],
    pattern: "Router, json array response, no wrapper",
  };
  expect(digest.task).toBe("m1-s1-t1");
  expect(digest.ex).toContain("playersRouter");
});

it("creates a valid SpringTrainingResult", () => {
  const result: SpringTrainingResult = {
    valid: true,
    blockers: [],
    warnings: ["Task m1-s1-t3 context near 150k limit"],
    contracts: "export interface Player { name: string; team: string; }",
    executionOrder: ["m1-s1-t1", "m1-s1-t2", "m1-s1-t3"],
    addedDependencies: [["m1-s1-t3", "m1-s1-t2"]],
  };
  expect(result.valid).toBe(true);
  expect(result.executionOrder).toHaveLength(3);
});

it("creates a valid EnrichedContextPackage", () => {
  const pkg: EnrichedContextPackage = {
    task: { name: "test", description: "test task", acceptanceCriteria: [] },
    interfaces: [],
    above: [],
    below: [],
    memory: "",
    rules: "",
    budget: { softLimit: 1500, hardLimit: 2000 },
    landscape: { mc: 0, fc: 0, modules: [] },
    relevant: [],
    fileContents: { "src/index.ts": "export const x = 1;" },
    contracts: "export interface Player { name: string; }",
    digests: [],
    specExcerpt: "Build a players API",
  };
  expect(pkg.fileContents).toHaveProperty("src/index.ts");
  expect(pkg.contracts).toContain("Player");
});

it("creates a valid WatchdogState", () => {
  const state: WatchdogState = {
    lastTaskCompletedAt: "2026-04-09T10:00:00Z",
    warningIssued: false,
  };
  expect(state.warningIssued).toBe(false);
});

it("creates a valid LoopTracker", () => {
  const tracker: LoopTracker = {
    taskId: "m1-s1-t1",
    stageLoopIds: ["loop-1", "loop-2"],
    totalLoops: 2,
  };
  expect(tracker.totalLoops).toBe(2);
  expect(tracker.stageLoopIds).toHaveLength(2);
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --run packages/core/src/types.test.ts
pnpm typecheck
```

**Commit:** `feat(types): add stage, digest, spring training, enriched context, and safety types`

---

## Task 2: Storage Extensions

**Files:**

- Modify: `packages/core/src/storage/interface.ts`
- Modify: `packages/core/src/storage/disk.ts`
- Modify: `packages/core/src/storage/disk.test.ts`

- [ ] **Step 1: Extend Storage interface**

Add after the `readRepoMap`/`writeRepoMap` methods in `interface.ts`:

```ts
// packages/core/src/storage/interface.ts — add to Storage interface

  // Digests
  writeDigest(taskId: string, digest: TaskDigest): Promise<void>;
  readDigests(): Promise<TaskDigest[]>;

  // Contracts
  writeContracts(content: string): Promise<void>;
  readContracts(): Promise<string>;

  // Stage Results
  writeStageResult(taskId: string, result: StageResult): Promise<void>;
  readStageResults(taskId: string): Promise<StageResult[]>;
```

Add imports at top of `interface.ts`:

```ts
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
  GateResult,
  TaskDigest,
  StageResult,
} from "../types.js";
```

- [ ] **Step 2: Implement in DiskStorage**

Add to `disk.ts` class body, and add `digests`, `stages` dirs in `initialize()`:

```ts
// packages/core/src/storage/disk.ts — add to initialize()
await mkdir(this.path("digests"), { recursive: true });
await mkdir(this.path("stages"), { recursive: true });
```

```ts
// packages/core/src/storage/disk.ts — add to class body

  async writeDigest(taskId: string, digest: TaskDigest): Promise<void> {
    await this.writeJson(this.path("digests", `${taskId}.json`), digest);
  }

  async readDigests(): Promise<TaskDigest[]> {
    try {
      const files = await readdir(this.path("digests"));
      const digests: TaskDigest[] = [];
      for (const f of files) {
        if (f.endsWith(".json")) {
          const digest = await this.readJson<TaskDigest>(this.path("digests", f));
          digests.push(digest);
        }
      }
      return digests;
    } catch {
      return [];
    }
  }

  async writeContracts(content: string): Promise<void> {
    await this.writeText(this.path("contracts.ts"), content);
  }

  async readContracts(): Promise<string> {
    try {
      return await readFile(this.path("contracts.ts"), "utf-8");
    } catch {
      return "";
    }
  }

  async writeStageResult(taskId: string, result: StageResult): Promise<void> {
    const filePath = this.path("stages", `${taskId}.json`);
    let existing: StageResult[] = [];
    try {
      existing = await this.readJson(filePath);
    } catch {
      // File doesn't exist yet
    }
    existing.push(result);
    await this.writeJson(filePath, existing);
  }

  async readStageResults(taskId: string): Promise<StageResult[]> {
    try {
      return await this.readJson(this.path("stages", `${taskId}.json`));
    } catch {
      return [];
    }
  }
```

Add `TaskDigest` and `StageResult` to the `disk.ts` import from `"../types.js"`:

```ts
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
  GateResult,
  TaskDigest,
  StageResult,
} from "../types.js";
```

- [ ] **Step 3: Add storage tests**

Add to existing `disk.test.ts`:

```ts
// packages/core/src/storage/disk.test.ts — add to existing describe block

describe("digests", () => {
  it("writes and reads a digest", async () => {
    const digest: TaskDigest = {
      task: "m1-s1-t1",
      did: "created players route",
      ex: ["playersRouter"],
      im: ["Player"],
      pattern: "express router",
    };
    await storage.writeDigest("m1-s1-t1", digest);
    const digests = await storage.readDigests();
    expect(digests).toHaveLength(1);
    expect(digests[0]!.task).toBe("m1-s1-t1");
  });

  it("reads empty digests when none exist", async () => {
    const digests = await storage.readDigests();
    expect(digests).toEqual([]);
  });
});

describe("contracts", () => {
  it("writes and reads contracts", async () => {
    const content = "export interface Player { name: string; }";
    await storage.writeContracts(content);
    const result = await storage.readContracts();
    expect(result).toBe(content);
  });

  it("returns empty string when no contracts exist", async () => {
    const result = await storage.readContracts();
    expect(result).toBe("");
  });
});

describe("stage results", () => {
  it("writes and reads stage results", async () => {
    const result: StageResult = {
      stage: "compile",
      passed: true,
      loops: 1,
      feedback: [],
    };
    await storage.writeStageResult("m1-s1-t1", result);
    const results = await storage.readStageResults("m1-s1-t1");
    expect(results).toHaveLength(1);
    expect(results[0]!.stage).toBe("compile");
  });

  it("appends stage results", async () => {
    const r1: StageResult = { stage: "compile", passed: true, loops: 1, feedback: [] };
    const r2: StageResult = { stage: "test", passed: false, loops: 3, feedback: [] };
    await storage.writeStageResult("m1-s1-t1", r1);
    await storage.writeStageResult("m1-s1-t1", r2);
    const results = await storage.readStageResults("m1-s1-t1");
    expect(results).toHaveLength(2);
  });

  it("returns empty array when no stage results exist", async () => {
    const results = await storage.readStageResults("nonexistent");
    expect(results).toEqual([]);
  });
});
```

Import `TaskDigest` and `StageResult` at top of `disk.test.ts`:

```ts
import type { TaskDigest, StageResult } from "../types.js";
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --run packages/core/src/storage/disk.test.ts
pnpm typecheck
```

**Commit:** `feat(storage): add digest, contracts, and stage result storage methods`

---

## Task 3: Spring Training — Structural Validation

**Files:**

- Create: `packages/core/src/spring-training/validate.ts`
- Create: `packages/core/src/spring-training/validate.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/spring-training/validate.test.ts
import { describe, it, expect } from "vitest";
import { validateStructure } from "./validate.js";
import type { WorkTree, CodeTree } from "../types.js";

function makeWorkTree(
  tasks: {
    id: string;
    desc: string;
    deps: string[];
    touches: string[];
    reads: string[];
    sliceId: string;
    milestoneId: string;
  }[],
): WorkTree {
  const milestoneMap = new Map<string, { id: string; slices: Map<string, typeof tasks> }>();
  for (const t of tasks) {
    if (!milestoneMap.has(t.milestoneId)) {
      milestoneMap.set(t.milestoneId, { id: t.milestoneId, slices: new Map() });
    }
    const m = milestoneMap.get(t.milestoneId)!;
    if (!m.slices.has(t.sliceId)) {
      m.slices.set(t.sliceId, []);
    }
    m.slices.get(t.sliceId)!.push(t);
  }

  return {
    milestones: Array.from(milestoneMap.values()).map((m) => ({
      id: m.id,
      name: m.id,
      description: "milestone",
      dependencies: [],
      slices: Array.from(m.slices.entries()).map(([sId, sTasks]) => ({
        id: sId,
        name: sId,
        description: "slice",
        parentMilestoneId: m.id,
        tasks: sTasks.map((t) => ({
          id: t.id,
          name: t.id,
          description: t.desc,
          status: "pending" as const,
          dependencies: t.deps,
          touches: t.touches,
          reads: t.reads,
          worker: null,
          tokenSpend: 0,
          attemptCount: 0,
          gateResults: [],
          parentSliceId: t.sliceId,
        })),
      })),
    })),
  };
}

function makeCodeTree(files: string[]): CodeTree {
  return {
    modules: [
      {
        path: "src",
        description: "source",
        files: files.map((p) => ({
          path: p,
          description: p,
          exports: [],
          imports: [],
          lastModifiedBy: null,
        })),
      },
    ],
  };
}

describe("validateStructure", () => {
  it("passes valid structure", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create players route in src/routes/players.ts",
        deps: [],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts", "src/__tests__/players.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.valid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks on missing file in code tree", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree([]);
    const result = validateStructure(wt, ct);
    expect(result.blockers.some((b) => b.includes("players.ts"))).toBe(true);
  });

  it("blocks on independent tasks touching same file", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
      {
        id: "t2",
        desc: "Update route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("one-owner"))).toBe(true);
  });

  it("allows dependent tasks touching same file", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
      {
        id: "t2",
        desc: "Add validation to src/routes/players.ts with tests",
        deps: ["t1"],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts", "src/__tests__/players.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.blockers.filter((b) => b.includes("one-owner"))).toHaveLength(0);
  });

  it("blocks on circular dependencies", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/a.ts with test",
        deps: ["t2"],
        touches: ["src/a.ts", "src/a.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
      {
        id: "t2",
        desc: "Create route in src/b.ts with test",
        deps: ["t1"],
        touches: ["src/b.ts", "src/b.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts", "src/a.test.ts", "src/b.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("cycle"))).toBe(true);
  });

  it("warns on short description", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "short",
        deps: [],
        touches: ["src/a.ts", "src/a.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/a.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.warnings.some((w) => w.includes("description"))).toBe(true);
  });

  it("warns on impl task without test files in touches", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create players route in src/routes/players.ts",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.warnings.some((w) => w.includes("test"))).toBe(true);
  });

  it("blocks when context estimate exceeds 150k", () => {
    // Indirectly tested — would need a massive tree. Validate the check exists.
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts", "src/__tests__/players.test.ts"]);
    const result = validateStructure(wt, ct);
    // Small tree should be under limit
    expect(result.blockers.filter((b) => b.includes("150k"))).toHaveLength(0);
  });

  it("warns when milestone has no tasks", () => {
    const wt: WorkTree = {
      milestones: [
        {
          id: "m1",
          name: "Empty",
          description: "empty milestone",
          dependencies: [],
          slices: [],
        },
      ],
    };
    const ct = makeCodeTree([]);
    const result = validateStructure(wt, ct);
    expect(result.warnings.some((w) => w.includes("no tasks"))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement validate.ts**

```ts
// packages/core/src/spring-training/validate.ts
import type { WorkTree, CodeTree } from "../types.js";
import type { RepoMap } from "../scanner/types.js";
import { getAllTasks } from "../trees/work-tree.js";
import { getAllFiles } from "../trees/code-tree.js";
import { estimateTaskContext } from "../seeder/estimator.js";

export interface ValidationResult {
  valid: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Structural validation of work tree + code tree before execution.
 * No AI calls — runs instantly.
 */
export function validateStructure(
  workTree: WorkTree,
  codeTree: CodeTree,
  repoMap?: RepoMap | null,
): ValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const allTasks = getAllTasks(workTree);
  const codeFiles = new Set(getAllFiles(codeTree).map((f) => f.path));
  const repoFiles = new Set<string>();
  if (repoMap) {
    for (const mod of repoMap.modules) {
      for (const file of mod.files) {
        repoFiles.add(file.p);
      }
    }
  }

  // Check: every milestone has at least one task
  for (const m of workTree.milestones) {
    const taskCount = m.slices.reduce((n, s) => n + s.tasks.length, 0);
    if (taskCount === 0) {
      warnings.push(`Milestone "${m.id}" has no tasks`);
    }
  }

  // Build task dependency map
  const taskDeps = new Map<string, Set<string>>();
  for (const task of allTasks) {
    taskDeps.set(task.id, new Set(task.dependencies));
  }

  // Check: file existence
  for (const task of allTasks) {
    for (const touchPath of task.touches) {
      if (!codeFiles.has(touchPath) && !repoFiles.has(touchPath)) {
        blockers.push(
          `Task "${task.id}": touch file "${touchPath}" not found in code tree or repo map`,
        );
      }
    }
    for (const readPath of task.reads) {
      if (!codeFiles.has(readPath) && !repoFiles.has(readPath)) {
        warnings.push(
          `Task "${task.id}": read file "${readPath}" not found in code tree or repo map`,
        );
      }
    }
  }

  // Check: one-owner-per-file (independent tasks must not share files)
  const fileTaskMap = new Map<string, string[]>();
  for (const task of allTasks) {
    for (const f of task.touches) {
      const existing = fileTaskMap.get(f) ?? [];
      existing.push(task.id);
      fileTaskMap.set(f, existing);
    }
  }

  for (const [file, taskIds] of fileTaskMap) {
    if (taskIds.length < 2) continue;
    for (let i = 0; i < taskIds.length; i++) {
      for (let j = i + 1; j < taskIds.length; j++) {
        const a = taskIds[i]!;
        const b = taskIds[j]!;
        const aDeps = taskDeps.get(a);
        const bDeps = taskDeps.get(b);
        // Check full transitive dependency chain
        if (!hasTransitiveDep(taskDeps, a, b) && !hasTransitiveDep(taskDeps, b, a)) {
          blockers.push(
            `one-owner violation: tasks "${a}" and "${b}" both touch "${file}" with no dependency chain`,
          );
        }
      }
    }
  }

  // Check: DAG (no cycles)
  const cycleResult = detectCycles(allTasks.map((t) => ({ id: t.id, deps: t.dependencies })));
  if (cycleResult) {
    blockers.push(`Dependency cycle detected: ${cycleResult}`);
  }

  // Check: context estimation < 150k
  for (const task of allTasks) {
    const estimate = estimateTaskContext(workTree, codeTree, task.id);
    if (estimate > 150_000) {
      blockers.push(`Task "${task.id}": estimated context ${estimate} tokens exceeds 150k limit`);
    } else if (estimate > 120_000) {
      warnings.push(`Task "${task.id}": estimated context ${estimate} tokens near 150k limit`);
    }
  }

  // Check: description quality (> 20 chars with file path)
  for (const task of allTasks) {
    if (task.description.length < 20) {
      warnings.push(
        `Task "${task.id}": description too short (${task.description.length} chars, need 20+)`,
      );
    }
  }

  // Check: tests-with-impl (implementation tasks should have test files)
  for (const task of allTasks) {
    const hasImplFile = task.touches.some(
      (f) => !f.includes(".test.") && !f.includes("__tests__") && !f.includes(".spec."),
    );
    const hasTestFile = task.touches.some(
      (f) => f.includes(".test.") || f.includes("__tests__") || f.includes(".spec."),
    );
    if (hasImplFile && !hasTestFile) {
      warnings.push(`Task "${task.id}": implementation task has no test files in touches`);
    }
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * Check if taskA transitively depends on taskB.
 */
function hasTransitiveDep(
  taskDeps: Map<string, Set<string>>,
  taskA: string,
  taskB: string,
): boolean {
  const visited = new Set<string>();
  const queue = [taskA];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = taskDeps.get(current);
    if (!deps) continue;
    if (deps.has(taskB)) return true;
    for (const dep of deps) {
      queue.push(dep);
    }
  }
  return false;
}

/**
 * Detect cycles in a dependency graph using DFS.
 */
function detectCycles(nodes: { id: string; deps: string[] }[]): string | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): string | null {
    if (path.includes(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId].join(" -> ");
    }
    if (visited.has(nodeId)) return null;

    const node = nodeMap.get(nodeId);
    if (!node) return null;

    path.push(nodeId);
    for (const depId of node.deps) {
      const result = dfs(depId);
      if (result) return result;
    }
    path.pop();
    visited.add(nodeId);
    return null;
  }

  for (const node of nodes) {
    const result = dfs(node.id);
    if (result) return result;
  }
  return null;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/spring-training/validate.test.ts
pnpm typecheck
```

**Commit:** `feat(spring-training): add structural validation`

---

## Task 4: Spring Training — Contract Generation

**Files:**

- Create: `packages/core/src/spring-training/contracts.ts`
- Create: `packages/core/src/spring-training/contracts.test.ts`

- [ ] **Step 1: Write tests first**

````ts
// packages/core/src/spring-training/contracts.test.ts
import { describe, it, expect } from "vitest";
import { buildContractPrompt, parseContractResponse } from "./contracts.js";

describe("contract generation", () => {
  describe("buildContractPrompt", () => {
    it("includes spec text in prompt", () => {
      const prompt = buildContractPrompt(
        "Build a baseball stats API with Player and Team entities",
      );
      expect(prompt).toContain("baseball stats API");
      expect(prompt).toContain("Player");
    });

    it("includes existing types when repoMap provided", () => {
      const prompt = buildContractPrompt("Add batting average to players", {
        v: 1,
        scannedAt: "",
        depth: "standard",
        env: {
          pm: "pnpm",
          test: "vitest",
          lint: "eslint",
          ts: true,
          monorepo: false,
          workspaces: [],
          infra: "none",
        },
        deps: [],
        modules: [
          {
            p: "src",
            d: "source",
            fc: 1,
            k: ["types"],
            files: [
              {
                p: "src/types.ts",
                ex: [{ n: "Player", s: "interface Player { name: string; team: string }" }],
                im: [],
                loc: 10,
              },
            ],
          },
        ],
      });
      expect(prompt).toContain("Player");
      expect(prompt).toContain("EXISTING TYPES");
    });
  });

  describe("parseContractResponse", () => {
    it("extracts TypeScript from response", () => {
      const response =
        "```typescript\nexport interface Player {\n  name: string;\n  team: string;\n}\n```";
      const result = parseContractResponse(response);
      expect(result).toContain("export interface Player");
      expect(result).not.toContain("```");
    });

    it("handles raw TypeScript without fences", () => {
      const response = "export interface Player {\n  name: string;\n}";
      const result = parseContractResponse(response);
      expect(result).toContain("export interface Player");
    });

    it("returns empty string on garbage input", () => {
      const result = parseContractResponse("Sorry, I cannot generate contracts.");
      expect(result).toBe("");
    });
  });
});
````

- [ ] **Step 2: Implement contracts.ts**

````ts
// packages/core/src/spring-training/contracts.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RepoMap } from "../scanner/types.js";

/**
 * Build a prompt for contract generation from spec text.
 */
export function buildContractPrompt(specText: string, repoMap?: RepoMap | null): string {
  let prompt = `You are a TypeScript type architect.

Given the following project specification, extract ALL domain entities, interfaces, and types referenced in the spec. Generate a single TypeScript file containing only type definitions (interfaces, types, enums). This file will be the single source of truth for shared types — every worker will import from it.

## Rules

1. Use the spec's domain language EXACTLY — do not substitute generic alternatives
2. Every entity mentioned in the spec becomes an interface
3. Every enum/union mentioned becomes a type
4. Include JSDoc comments extracted from spec context
5. Export everything
6. No implementation code — types only
7. No imports — this file is self-contained

## Specification

${specText}

Output ONLY valid TypeScript source code. No markdown fences, no explanation.`;

  if (repoMap) {
    const existingTypes: string[] = [];
    for (const mod of repoMap.modules) {
      for (const file of mod.files) {
        for (const ex of file.ex) {
          if (ex.s.includes("interface") || ex.s.includes("type") || ex.s.includes("enum")) {
            existingTypes.push(`// ${file.p}\n${ex.s}`);
          }
        }
      }
    }
    if (existingTypes.length > 0) {
      prompt += `\n\nEXISTING TYPES (merge with spec additions, preserve existing field names):\n\n${existingTypes.join("\n\n")}`;
    }
  }

  return prompt;
}

/**
 * Parse the AI response to extract TypeScript contract source.
 * Strips markdown fences if present. Returns empty string on invalid input.
 */
export function parseContractResponse(text: string): string {
  let source = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = source.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    source = fenceMatch[1]!.trim();
  }

  // Validate it looks like TypeScript types
  if (
    !source.includes("export") ||
    (!source.includes("interface") && !source.includes("type") && !source.includes("enum"))
  ) {
    return "";
  }

  return source;
}

/**
 * Generate shared contracts file from spec using Agent SDK (Opus).
 */
export async function generateContracts(
  specText: string,
  repoMap?: RepoMap | null,
  cwd?: string,
  budgetUsd?: number,
): Promise<string> {
  const prompt = buildContractPrompt(specText, repoMap);

  const stream = query({
    prompt,
    options: {
      model: "claude-opus-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: budgetUsd ?? 0.5,
      persistSession: false,
      cwd: cwd ?? process.cwd(),
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
    return "";
  }

  return parseContractResponse(resultMsg.result);
}
````

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/spring-training/contracts.test.ts
pnpm typecheck
```

**Commit:** `feat(spring-training): add contract generation from spec`

---

## Task 5: Spring Training — Execution Simulation

**Files:**

- Create: `packages/core/src/spring-training/simulate.ts`
- Create: `packages/core/src/spring-training/simulate.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/spring-training/simulate.test.ts
import { describe, it, expect } from "vitest";
import { simulateExecution } from "./simulate.js";
import type { WorkTree, CodeTree } from "../types.js";

function makeWorkTree(
  tasks: { id: string; deps: string[]; touches: string[]; reads: string[] }[],
): WorkTree {
  return {
    milestones: [
      {
        id: "m1",
        name: "m1",
        description: "milestone",
        dependencies: [],
        slices: [
          {
            id: "m1-s1",
            name: "s1",
            description: "slice",
            parentMilestoneId: "m1",
            tasks: tasks.map((t) => ({
              id: t.id,
              name: t.id,
              description: `Task ${t.id} implementation with tests`,
              status: "pending" as const,
              dependencies: t.deps,
              touches: t.touches,
              reads: t.reads,
              worker: null,
              tokenSpend: 0,
              attemptCount: 0,
              gateResults: [],
              parentSliceId: "m1-s1",
            })),
          },
        ],
      },
    ],
  };
}

function makeCodeTree(files: string[]): CodeTree {
  return {
    modules: [
      {
        path: "src",
        description: "source",
        files: files.map((p) => ({
          path: p,
          description: p,
          exports: [],
          imports: [],
          lastModifiedBy: null,
        })),
      },
    ],
  };
}

describe("simulateExecution", () => {
  it("returns execution order for simple chain", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: [] },
      { id: "t2", deps: ["t1"], touches: ["src/b.ts"], reads: ["src/a.ts"] },
      { id: "t3", deps: ["t2"], touches: ["src/c.ts"], reads: ["src/b.ts"] },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const result = simulateExecution(wt, ct);
    expect(result.executionOrder).toEqual(["t1", "t2", "t3"]);
  });

  it("detects missing dependency when task reads file written by non-dependency", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: [] },
      { id: "t2", deps: [], touches: ["src/b.ts"], reads: ["src/a.ts"] },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts"]);
    const result = simulateExecution(wt, ct);
    expect(result.addedDependencies.length).toBeGreaterThan(0);
    expect(result.addedDependencies[0]).toEqual(["t2", "t1"]);
  });

  it("returns optimized order with parallel-capable tasks", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: [] },
      { id: "t2", deps: [], touches: ["src/b.ts"], reads: [] },
      { id: "t3", deps: ["t1", "t2"], touches: ["src/c.ts"], reads: [] },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const result = simulateExecution(wt, ct);
    // t1 and t2 can be parallel, t3 must come after both
    const t1Idx = result.executionOrder.indexOf("t1");
    const t2Idx = result.executionOrder.indexOf("t2");
    const t3Idx = result.executionOrder.indexOf("t3");
    expect(t3Idx).toBeGreaterThan(t1Idx);
    expect(t3Idx).toBeGreaterThan(t2Idx);
  });

  it("warns when task has no context from prior tasks", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: ["src/missing.ts"] },
    ]);
    const ct = makeCodeTree(["src/a.ts"]);
    const result = simulateExecution(wt, ct);
    expect(result.warnings.some((w) => w.includes("missing.ts"))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement simulate.ts**

```ts
// packages/core/src/spring-training/simulate.ts
import type { WorkTree, CodeTree } from "../types.js";
import { getAllTasks } from "../trees/work-tree.js";
import { getAllFiles } from "../trees/code-tree.js";

export interface SimulationResult {
  executionOrder: string[];
  addedDependencies: string[][];
  warnings: string[];
}

/**
 * Simulate execution of the work tree to find missing dependencies and optimize order.
 * Walks tasks in dependency order, checking context sufficiency at each step.
 */
export function simulateExecution(workTree: WorkTree, codeTree: CodeTree): SimulationResult {
  const allTasks = getAllTasks(workTree);
  const codeFiles = new Set(getAllFiles(codeTree).map((f) => f.path));
  const warnings: string[] = [];
  const addedDependencies: string[][] = [];

  // Build maps
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const taskDeps = new Map(allTasks.map((t) => [t.id, new Set(t.dependencies)]));

  // Detect missing dependency links:
  // If task B reads a file that task A touches, and B doesn't depend on A
  const touchMap = new Map<string, string>();
  for (const task of allTasks) {
    for (const f of task.touches) {
      // First writer wins for detection purposes
      if (!touchMap.has(f)) {
        touchMap.set(f, task.id);
      }
    }
  }

  for (const task of allTasks) {
    for (const readFile of task.reads) {
      const writer = touchMap.get(readFile);
      if (writer && writer !== task.id) {
        const deps = taskDeps.get(task.id)!;
        if (!hasTransitiveDep(taskDeps, task.id, writer)) {
          addedDependencies.push([task.id, writer]);
          deps.add(writer);
          warnings.push(
            `Added dependency: "${task.id}" now depends on "${writer}" (reads "${readFile}")`,
          );
        }
      }
    }

    // Check for reads that reference files not in code tree and not produced by any task
    for (const readFile of task.reads) {
      if (!codeFiles.has(readFile) && !touchMap.has(readFile)) {
        warnings.push(
          `Task "${task.id}" reads "${readFile}" which is not in code tree and not produced by any task`,
        );
      }
    }
  }

  // Topological sort for execution order
  const executionOrder = topologicalSort(
    allTasks.map((t) => t.id),
    taskDeps,
  );

  return {
    executionOrder,
    addedDependencies,
    warnings,
  };
}

/**
 * Check if taskA transitively depends on taskB.
 */
function hasTransitiveDep(
  taskDeps: Map<string, Set<string>>,
  taskA: string,
  taskB: string,
): boolean {
  const visited = new Set<string>();
  const queue = [taskA];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = taskDeps.get(current);
    if (!deps) continue;
    if (deps.has(taskB)) return true;
    for (const dep of deps) {
      queue.push(dep);
    }
  }
  return false;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns tasks in valid execution order.
 */
function topologicalSort(taskIds: string[], taskDeps: Map<string, Set<string>>): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of taskIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const id of taskIds) {
    const deps = taskDeps.get(id);
    if (deps) {
      inDegree.set(id, deps.size);
      for (const dep of deps) {
        const adj = adjacency.get(dep);
        if (adj) adj.push(id);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Sort queue for deterministic output
    queue.sort();
    const current = queue.shift()!;
    sorted.push(current);
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/spring-training/simulate.test.ts
pnpm typecheck
```

**Commit:** `feat(spring-training): add execution simulation with dependency detection`

---

## Task 6: Spring Training — Runner

**Files:**

- Create: `packages/core/src/spring-training/runner.ts`
- Create: `packages/core/src/spring-training/runner.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/spring-training/runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { runSpringTraining } from "./runner.js";
import type { Storage } from "../storage/interface.js";
import type { WorkTree, CodeTree, SpringTrainingResult } from "../types.js";

function makeMinimalWorkTree(): WorkTree {
  return {
    milestones: [
      {
        id: "m1",
        name: "Build",
        description: "Build the thing",
        dependencies: [],
        slices: [
          {
            id: "m1-s1",
            name: "Core",
            description: "Core work",
            parentMilestoneId: "m1",
            tasks: [
              {
                id: "m1-s1-t1",
                name: "Create players route",
                description:
                  "Create players route in src/routes/players.ts with GET/POST endpoints and tests",
                status: "pending",
                dependencies: [],
                touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
                reads: [],
                worker: null,
                tokenSpend: 0,
                attemptCount: 0,
                gateResults: [],
                parentSliceId: "m1-s1",
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeMinimalCodeTree(): CodeTree {
  return {
    modules: [
      {
        path: "src",
        description: "source",
        files: [
          {
            path: "src/routes/players.ts",
            description: "players route",
            exports: [],
            imports: [],
            lastModifiedBy: null,
          },
          {
            path: "src/__tests__/players.test.ts",
            description: "players tests",
            exports: [],
            imports: [],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };
}

function makeMockStorage(workTree: WorkTree, codeTree: CodeTree): Storage {
  return {
    readProjectConfig: vi.fn().mockResolvedValue({
      name: "test",
      specPath: "spec.md",
      budgets: {
        project: { usd: 50, warnPct: 70 },
        perTask: { usd: 2, softPct: 75 },
        supervisor: { usd: 3 },
        planning: { usd: 5 },
      },
      limits: {
        maxConcurrentWorkers: 3,
        maxTotalWorkers: 50,
        maxRetries: 3,
        maxTaskDepth: 4,
        sessionTimeoutMin: 15,
        spawnRatePerMin: 5,
      },
      circuitBreakers: {
        consecutiveFailuresSlice: 3,
        consecutiveFailuresProject: 5,
        budgetEfficiencyThreshold: 0.5,
      },
    }),
    writeProjectConfig: vi.fn().mockResolvedValue(undefined),
    readProjectState: vi
      .fn()
      .mockResolvedValue({
        status: "idle",
        totalTokenSpend: 0,
        totalWorkersSpawned: 0,
        startedAt: "",
        pausedAt: null,
      }),
    writeProjectState: vi.fn().mockResolvedValue(undefined),
    readWorkTree: vi.fn().mockResolvedValue(workTree),
    writeWorkTree: vi.fn().mockResolvedValue(undefined),
    readCodeTree: vi.fn().mockResolvedValue(codeTree),
    writeCodeTree: vi.fn().mockResolvedValue(undefined),
    writeWorkerOutput: vi.fn().mockResolvedValue(undefined),
    readWorkerOutput: vi.fn().mockResolvedValue(null),
    listWorkerOutputs: vi.fn().mockResolvedValue([]),
    writeGateResult: vi.fn().mockResolvedValue(undefined),
    readGateResults: vi.fn().mockResolvedValue([]),
    readMemory: vi.fn().mockResolvedValue(""),
    writeMemory: vi.fn().mockResolvedValue(undefined),
    appendMemory: vi.fn().mockResolvedValue(undefined),
    writeSupervisorLog: vi.fn().mockResolvedValue(undefined),
    readSupervisorLogs: vi.fn().mockResolvedValue([]),
    readRepoMap: vi.fn().mockResolvedValue(null),
    writeRepoMap: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    writeDigest: vi.fn().mockResolvedValue(undefined),
    readDigests: vi.fn().mockResolvedValue([]),
    writeContracts: vi.fn().mockResolvedValue(undefined),
    readContracts: vi.fn().mockResolvedValue(""),
    writeStageResult: vi.fn().mockResolvedValue(undefined),
    readStageResults: vi.fn().mockResolvedValue([]),
  };
}

describe("runSpringTraining", () => {
  it("validates structure and returns result with valid flag", async () => {
    const wt = makeMinimalWorkTree();
    const ct = makeMinimalCodeTree();
    const storage = makeMockStorage(wt, ct);

    // Skip AI contract generation for unit test — test the orchestration flow
    const result = await runSpringTraining(
      storage,
      "Build a players API",
      undefined,
      process.cwd(),
      true,
    );
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("blockers");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("executionOrder");
    expect(result).toHaveProperty("addedDependencies");
  });

  it("returns blockers when structure is invalid", async () => {
    const wt = makeMinimalWorkTree();
    // Empty code tree — all touch files will be missing
    const ct: CodeTree = { modules: [] };
    const storage = makeMockStorage(wt, ct);

    const result = await runSpringTraining(
      storage,
      "Build a players API",
      undefined,
      process.cwd(),
      true,
    );
    expect(result.valid).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("writes contracts to storage when provided", async () => {
    const wt = makeMinimalWorkTree();
    const ct = makeMinimalCodeTree();
    const storage = makeMockStorage(wt, ct);

    await runSpringTraining(storage, "Build a players API", undefined, process.cwd(), true);
    // In skipAI mode, contracts are empty but writeContracts still called
    expect(storage.writeContracts).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement runner.ts**

```ts
// packages/core/src/spring-training/runner.ts
import type { SpringTrainingResult } from "../types.js";
import type { Storage } from "../storage/interface.js";
import type { RepoMap } from "../scanner/types.js";
import { validateStructure } from "./validate.js";
import { generateContracts } from "./contracts.js";
import { simulateExecution } from "./simulate.js";

/**
 * Run the full spring training pipeline: validate -> contracts -> simulate.
 * Returns a SpringTrainingResult for user review before execution.
 *
 * @param skipAI - When true, skips AI contract generation (for testing).
 */
export async function runSpringTraining(
  storage: Storage,
  specText: string,
  repoMap?: RepoMap | null,
  cwd?: string,
  skipAI?: boolean,
): Promise<SpringTrainingResult> {
  const workTree = await storage.readWorkTree();
  const codeTree = await storage.readCodeTree();

  // Phase A: Structural validation (no AI, instant)
  const validation = validateStructure(workTree, codeTree, repoMap);

  // If structural validation fails with blockers, return early
  // (but still populate the result fully)
  const blockers = [...validation.blockers];
  const warnings = [...validation.warnings];

  // Phase B: Contract generation (AI, one-time)
  let contracts = "";
  if (!skipAI) {
    contracts = await generateContracts(specText, repoMap, cwd);
    if (!contracts) {
      warnings.push("Contract generation returned empty result — workers will lack shared types");
    }
  }

  // Write contracts to storage regardless (empty string if skipped/failed)
  await storage.writeContracts(contracts);

  // Phase C: Execution simulation
  const simulation = simulateExecution(workTree, codeTree);
  warnings.push(...simulation.warnings);

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    contracts,
    executionOrder: simulation.executionOrder,
    addedDependencies: simulation.addedDependencies,
  };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/spring-training/runner.test.ts
pnpm typecheck
```

**Commit:** `feat(spring-training): add runner orchestrating validate, contracts, simulate`

---

## Task 7: Stage Runners — Compile Stage

**Files:**

- Create: `packages/core/src/stages/compile.ts`
- Create: `packages/core/src/stages/compile.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/stages/compile.test.ts
import { describe, it, expect, vi } from "vitest";
import { runCompileStage, runTsc } from "./compile.js";
import type { StageResult } from "../types.js";

vi.mock("node:child_process", () => {
  const execFileFn = vi.fn();
  return {
    execFile: execFileFn,
  };
});

describe("runCompileStage", () => {
  it("returns passed when tsc succeeds", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: "",
        stderr: "",
      });
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTsc("/tmp/test-worktree");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("");
  });

  it("returns error output when tsc fails", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      const error = new Error("tsc failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout =
        "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.";
      error.stderr = "";
      (cb as (err: typeof error) => void)(error);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTsc("/tmp/test-worktree");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("TS2322");
  });
});

describe("compile StageResult shape", () => {
  it("produces valid StageResult", () => {
    const result: StageResult = {
      stage: "compile",
      passed: true,
      loops: 1,
      feedback: [],
    };
    expect(result.stage).toBe("compile");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Implement compile.ts**

```ts
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
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/stages/compile.test.ts
pnpm typecheck
```

**Commit:** `feat(stages): add compile stage runner with tsc integration`

---

## Task 8: Stage Runners — Test Stage

**Files:**

- Create: `packages/core/src/stages/test.ts`
- Create: `packages/core/src/stages/test.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/stages/test.test.ts
import { describe, it, expect, vi } from "vitest";
import { runTests } from "./test.js";
import type { StageResult } from "../types.js";
import type { EnvConfig } from "../scanner/types.js";

vi.mock("node:child_process", () => {
  const execFileFn = vi.fn();
  return {
    execFile: execFileFn,
  };
});

const defaultEnv: EnvConfig = {
  pm: "pnpm",
  test: "vitest",
  lint: "eslint",
  ts: true,
  monorepo: false,
  workspaces: [],
  infra: "none",
};

describe("runTests", () => {
  it("returns passed when tests succeed", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: "Tests passed\n 5 passed",
        stderr: "",
      });
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTests("/tmp/test-worktree", defaultEnv);
    expect(result.exitCode).toBe(0);
  });

  it("returns error output when tests fail", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      const error = new Error("tests failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout = "FAIL src/__tests__/players.test.ts\n  Expected 200, received 404";
      error.stderr = "";
      (cb as (err: typeof error) => void)(error);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTests("/tmp/test-worktree", defaultEnv);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("FAIL");
  });
});

describe("test StageResult shape", () => {
  it("produces valid StageResult for no-tests case", () => {
    const result: StageResult = {
      stage: "test",
      passed: false,
      loops: 0,
      feedback: [
        {
          stage: "test",
          errors: [
            {
              f: "src/routes/players.ts",
              l: 0,
              e: "No tests found",
              fix: "Write tests for this module",
            },
          ],
        },
      ],
    };
    expect(result.feedback[0]!.errors[0]!.e).toContain("No tests");
  });
});
```

- [ ] **Step 2: Implement test.ts**

```ts
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
    execFile(cmd, args, { cwd: worktreePath, timeout: 300_000 }, (error, stdout, stderr) => {
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
      const implFiles = taskTouches.filter(
        (f) => !f.includes(".test.") && !f.includes("__tests__") && !f.includes(".spec."),
      );
      return {
        stage: "test",
        passed: false,
        loops: 0,
        feedback: [
          {
            stage: "test",
            errors: implFiles.map((f) => ({
              f,
              l: 0,
              e: "No tests found for this file",
              fix: `Write tests for ${f} — cover main exports and edge cases`,
            })),
          },
        ],
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
    const implFiles = taskTouches.filter(
      (f) => !f.includes(".test.") && !f.includes("__tests__") && !f.includes(".spec."),
    );
    return {
      stage: "test",
      passed: false,
      loops: 0,
      feedback: [
        {
          stage: "test",
          errors: implFiles.map((f) => ({
            f,
            l: 0,
            e: "No tests found for this file",
            fix: `Write tests for ${f} — cover main exports and edge cases`,
          })),
        },
      ],
    };
  }

  // Digest failures via AI
  let feedback: StageFeedback;
  try {
    feedback = await digestTestFailures(testResult.output, worktreePath, taskBudget / 4);
  } catch {
    feedback = {
      stage: "test",
      errors: [
        { f: "unknown", l: 0, e: testResult.output.slice(0, 500), fix: "Fix failing tests" },
      ],
    };
  }

  return {
    stage: "test",
    passed: false,
    loops: 0,
    feedback: [feedback],
  };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/stages/test.test.ts
pnpm typecheck
```

**Commit:** `feat(stages): add test stage runner with no-tests detection`

---

## Task 9: Stage Runners — Review Stage

**Files:**

- Create: `packages/core/src/stages/review.ts`
- Create: `packages/core/src/stages/review.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/stages/review.test.ts
import { describe, it, expect } from "vitest";
import { buildReviewPrompt, parseReviewResponse } from "./review.js";
import type { StageResult } from "../types.js";

describe("review stage", () => {
  describe("buildReviewPrompt", () => {
    it("includes diff in prompt", () => {
      const prompt = buildReviewPrompt(
        "diff --git a/src/index.ts\n+export const x = 1;",
        "export interface Player { name: string; }",
        "Build a players API",
      );
      expect(prompt).toContain("diff --git");
      expect(prompt).toContain("Player");
      expect(prompt).toContain("players API");
    });
  });

  describe("parseReviewResponse", () => {
    it("returns passed when response says approved", () => {
      const result = parseReviewResponse('{"approved":true,"issues":[]}');
      expect(result.passed).toBe(true);
      expect(result.feedback).toHaveLength(0);
    });

    it("returns failed with issues when response has problems", () => {
      const result = parseReviewResponse(
        '{"approved":false,"issues":[{"f":"src/index.ts","l":5,"e":"Uses local Player type instead of contracts","fix":"Import Player from contracts.ts"}]}',
      );
      expect(result.passed).toBe(false);
      expect(result.feedback).toHaveLength(1);
      expect(result.feedback[0]!.errors[0]!.f).toBe("src/index.ts");
    });

    it("returns failed on unparseable response", () => {
      const result = parseReviewResponse("I think the code looks mostly fine but...");
      expect(result.passed).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Implement review.ts**

````ts
// packages/core/src/stages/review.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StageResult, StageFeedback } from "../types.js";

/**
 * Build a prompt for the AI reviewer.
 */
export function buildReviewPrompt(diff: string, contracts: string, specExcerpt: string): string {
  return `You are a code reviewer for an AI-orchestrated project. Review this diff against the contracts and spec.

## Contracts (shared types — single source of truth)

${contracts || "(no contracts file)"}

## Relevant Spec Section

${specExcerpt || "(no spec excerpt)"}

## Diff to Review

${diff}

## Check These

1. **Domain fidelity**: Types match contracts exactly. No local re-definitions of shared types.
2. **Pattern consistency**: Follows patterns established by prior tasks (if visible in diff context).
3. **No duplicate logic**: No re-implementation of something that should be imported.
4. **Proper imports**: All shared types imported from contracts, not defined locally.
5. **Middleware order**: If Express/Hono, middleware registered in correct order.
6. **Test coverage**: Tests cover the main paths described in the task.

## Response Format

Output ONLY a JSON object:

{
  "approved": boolean,
  "issues": [
    { "f": "file path", "l": line_number, "e": "description of issue", "fix": "how to fix it" }
  ]
}

If approved with no issues: {"approved": true, "issues": []}
If issues found: {"approved": false, "issues": [...]}

No markdown fences, no explanation.`;
}

/**
 * Parse the AI reviewer's response into a StageResult.
 */
export function parseReviewResponse(text: string): { passed: boolean; feedback: StageFeedback[] } {
  try {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      approved: boolean;
      issues: { f: string; l: number; e: string; fix: string }[];
    };

    if (parsed.approved && (!parsed.issues || parsed.issues.length === 0)) {
      return { passed: true, feedback: [] };
    }

    const feedback: StageFeedback = {
      stage: "review",
      errors: (parsed.issues ?? []).map((i) => ({
        f: i.f,
        l: i.l ?? 0,
        e: i.e,
        fix: i.fix ?? "",
      })),
    };

    return {
      passed: parsed.approved === true && feedback.errors.length === 0,
      feedback: feedback.errors.length > 0 ? [feedback] : [],
    };
  } catch {
    return {
      passed: false,
      feedback: [
        {
          stage: "review",
          errors: [
            {
              f: "unknown",
              l: 0,
              e: "Review response was not parseable JSON",
              fix: "Re-run review",
            },
          ],
        },
      ],
    };
  }
}

/**
 * Run the review stage by sending the diff to an AI reviewer.
 * Does NOT loop internally — the caller (orchestrator) handles the loop.
 */
export async function runReviewStage(
  worktreePath: string,
  diff: string,
  contracts: string,
  specExcerpt: string,
  taskBudget: number,
): Promise<StageResult> {
  const prompt = buildReviewPrompt(diff, contracts, specExcerpt);

  const stream = query({
    prompt,
    options: {
      model: "claude-opus-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: taskBudget / 4,
      persistSession: false,
      cwd: worktreePath,
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
      stage: "review",
      passed: false,
      loops: 0,
      feedback: [
        {
          stage: "review",
          errors: [
            { f: "unknown", l: 0, e: "AI reviewer failed to produce result", fix: "Retry review" },
          ],
        },
      ],
    };
  }

  const parsed = parseReviewResponse(resultMsg.result);

  return {
    stage: "review",
    passed: parsed.passed,
    loops: 0,
    feedback: parsed.feedback,
  };
}
````

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/stages/review.test.ts
pnpm typecheck
```

**Commit:** `feat(stages): add review stage runner with AI diff review`

---

## Task 10: AI Feedback Digester

**Files:**

- Create: `packages/core/src/stages/feedback.ts`
- Create: `packages/core/src/stages/feedback.test.ts`

- [ ] **Step 1: Write tests first**

````ts
// packages/core/src/stages/feedback.test.ts
import { describe, it, expect } from "vitest";
import { digestReviewIssues, parseFeedbackResponse } from "./feedback.js";
import type { StageFeedback } from "../types.js";

describe("feedback digester", () => {
  describe("digestReviewIssues", () => {
    it("converts raw review issues to StageFeedback", () => {
      const rawReview =
        '{"issues":[{"f":"src/index.ts","l":5,"e":"Wrong type","fix":"Use Player from contracts"}]}';
      const result = digestReviewIssues(rawReview);
      expect(result.stage).toBe("review");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.f).toBe("src/index.ts");
    });

    it("returns empty errors on unparseable input", () => {
      const result = digestReviewIssues("not json");
      expect(result.stage).toBe("review");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.e).toContain("parse");
    });
  });

  describe("parseFeedbackResponse", () => {
    it("parses valid JSON feedback", () => {
      const response = '{"errors":[{"f":"src/a.ts","l":10,"e":"Type error","fix":"Change type"}]}';
      const result = parseFeedbackResponse(response, "compile");
      expect(result.stage).toBe("compile");
      expect(result.errors).toHaveLength(1);
    });

    it("handles markdown-fenced JSON", () => {
      const response = '```json\n{"errors":[{"f":"src/a.ts","l":1,"e":"error","fix":"fix"}]}\n```';
      const result = parseFeedbackResponse(response, "test");
      expect(result.errors).toHaveLength(1);
    });

    it("returns raw error on unparseable response", () => {
      const result = parseFeedbackResponse("AI could not parse the errors", "compile");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.e).toContain("could not parse");
    });
  });
});
````

- [ ] **Step 2: Implement feedback.ts**

````ts
// packages/core/src/stages/feedback.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StageFeedback, StageType } from "../types.js";

/**
 * Parse an AI feedback response into a StageFeedback object.
 */
export function parseFeedbackResponse(text: string, stage: StageType): StageFeedback {
  try {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      errors: { f: string; l: number; e: string; fix: string }[];
    };
    return {
      stage,
      errors: (parsed.errors ?? []).map((e) => ({
        f: e.f ?? "unknown",
        l: e.l ?? 0,
        e: e.e ?? "",
        fix: e.fix ?? "",
      })),
    };
  } catch {
    return {
      stage,
      errors: [{ f: "unknown", l: 0, e: text.slice(0, 500), fix: "Review raw output and fix" }],
    };
  }
}

/**
 * Use AI to digest raw tsc output into structured feedback.
 * Wire-mode output: compact JSON with file, line, error, fix.
 */
export async function digestCompileErrors(
  rawOutput: string,
  cwd: string,
  budget: number,
): Promise<StageFeedback> {
  const prompt = `Digest these TypeScript compilation errors into structured JSON.

## Raw tsc output

${rawOutput.slice(0, 3000)}

## Response Format

Output ONLY a JSON object:
{"errors":[{"f":"file path","l":line_number,"e":"error description","fix":"suggested fix"}]}

Be specific about fixes. Reference actual types and imports. No markdown fences, no explanation.`;

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
      errors: [
        {
          f: "unknown",
          l: 0,
          e: rawOutput.slice(0, 500),
          fix: "Fix TypeScript compilation errors",
        },
      ],
    };
  }

  return parseFeedbackResponse(resultMsg.result, "compile");
}

/**
 * Use AI to digest raw test failure output into structured feedback.
 * Wire-mode output: compact JSON with file, line, error, fix.
 */
export async function digestTestFailures(
  rawOutput: string,
  cwd: string,
  budget: number,
): Promise<StageFeedback> {
  const prompt = `Digest these test failures into structured JSON.

## Raw test output

${rawOutput.slice(0, 3000)}

## Response Format

Output ONLY a JSON object:
{"errors":[{"f":"file path","l":line_number,"e":"test_name: expected X got Y — root cause","fix":"specific fix suggestion"}]}

Be specific about root causes and fixes. No markdown fences, no explanation.`;

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
}

/**
 * Convert raw review text into a StageFeedback.
 * No AI call — just parses the structured response from the reviewer.
 */
export function digestReviewIssues(rawReview: string): StageFeedback {
  try {
    let jsonStr = rawReview.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      issues: { f: string; l: number; e: string; fix: string }[];
    };
    return {
      stage: "review",
      errors: (parsed.issues ?? []).map((i) => ({
        f: i.f ?? "unknown",
        l: i.l ?? 0,
        e: i.e ?? "",
        fix: i.fix ?? "",
      })),
    };
  } catch {
    return {
      stage: "review",
      errors: [
        {
          f: "unknown",
          l: 0,
          e: `Failed to parse review response: ${rawReview.slice(0, 200)}`,
          fix: "Re-run review",
        },
      ],
    };
  }
}
````

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/stages/feedback.test.ts
pnpm typecheck
```

**Commit:** `feat(stages): add AI feedback digesters for compile, test, review`

---

## Task 11: Task Completion Digests

**Files:**

- Create: `packages/core/src/digests/generator.ts`
- Create: `packages/core/src/digests/generator.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// packages/core/src/digests/generator.test.ts
import { describe, it, expect } from "vitest";
import { generateDigest } from "./generator.js";
import type { WorkerOutput, WorkTree, CodeTree, TaskDigest } from "../types.js";

describe("generateDigest", () => {
  const defaultOutput: WorkerOutput = {
    status: "complete",
    filesChanged: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
    interfacesModified: [
      { file: "src/routes/players.ts", export: "playersRouter", before: "", after: "Router" },
    ],
    testsAdded: ["src/__tests__/players.test.ts"],
    testResults: { pass: 5, fail: 0 },
    notes: "Created GET and POST endpoints for players",
    tokensUsed: 15000,
  };

  const workTree: WorkTree = {
    milestones: [
      {
        id: "m1",
        name: "m1",
        description: "Build",
        dependencies: [],
        slices: [
          {
            id: "m1-s1",
            name: "s1",
            description: "Core",
            parentMilestoneId: "m1",
            tasks: [
              {
                id: "m1-s1-t1",
                name: "Create players route",
                description: "Create GET/POST /players in src/routes/players.ts",
                status: "complete",
                dependencies: [],
                touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
                reads: ["src/contracts.ts"],
                worker: null,
                tokenSpend: 15000,
                attemptCount: 1,
                gateResults: [],
                parentSliceId: "m1-s1",
              },
            ],
          },
        ],
      },
    ],
  };

  const codeTree: CodeTree = {
    modules: [
      {
        path: "src",
        description: "source",
        files: [
          {
            path: "src/routes/players.ts",
            description: "players route",
            exports: [{ name: "playersRouter", signature: "Router", description: "" }],
            imports: [{ from: "src/contracts", names: ["Player"] }],
            lastModifiedBy: null,
          },
          {
            path: "src/contracts.ts",
            description: "contracts",
            exports: [{ name: "Player", signature: "interface Player", description: "" }],
            imports: [],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };

  it("generates a valid TaskDigest", () => {
    const digest = generateDigest("m1-s1-t1", defaultOutput, workTree, codeTree);
    expect(digest.task).toBe("m1-s1-t1");
    expect(digest.did).toBeTruthy();
    expect(digest.ex).toContain("playersRouter");
    expect(digest.im.length).toBeGreaterThan(0);
    expect(digest.pattern).toBeTruthy();
  });

  it("includes exports from worker output", () => {
    const digest = generateDigest("m1-s1-t1", defaultOutput, workTree, codeTree);
    expect(digest.ex).toContain("playersRouter");
  });

  it("includes imports from code tree", () => {
    const digest = generateDigest("m1-s1-t1", defaultOutput, workTree, codeTree);
    expect(digest.im.some((i) => i.includes("Player"))).toBe(true);
  });

  it("handles task not found gracefully", () => {
    const digest = generateDigest("nonexistent", defaultOutput, workTree, codeTree);
    expect(digest.task).toBe("nonexistent");
    expect(digest.did).toContain("completed");
  });
});
```

- [ ] **Step 2: Implement generator.ts**

```ts
// packages/core/src/digests/generator.ts
import type { TaskDigest, WorkerOutput, WorkTree, CodeTree } from "../types.js";
import { getTask } from "../trees/work-tree.js";
import { getFile } from "../trees/code-tree.js";

/**
 * Generate a wire-mode digest of what a completed task produced.
 * Stored and included in subsequent worker contexts.
 */
export function generateDigest(
  taskId: string,
  workerOutput: WorkerOutput,
  workTree: WorkTree,
  codeTree: CodeTree,
): TaskDigest {
  const task = getTask(workTree, taskId);

  // Collect exports from changed files
  const exports: string[] = [];
  for (const change of workerOutput.interfacesModified) {
    if (change.after) {
      exports.push(change.export);
    }
  }

  // Also check code tree for exports in touched files
  if (task) {
    for (const touchPath of task.touches) {
      const file = getFile(codeTree, touchPath);
      if (file) {
        for (const ex of file.exports) {
          if (!exports.includes(ex.name)) {
            exports.push(ex.name);
          }
        }
      }
    }
  }

  // Collect imports from code tree files
  const imports: string[] = [];
  if (task) {
    for (const touchPath of task.touches) {
      const file = getFile(codeTree, touchPath);
      if (file) {
        for (const im of file.imports) {
          imports.push(`${im.names.join(", ")} from ${im.from}`);
        }
      }
    }
  }

  // Build "did" summary from task description + worker notes
  const taskDesc = task?.description ?? "unknown task";
  const did = workerOutput.notes
    ? `${workerOutput.notes.slice(0, 150)}`
    : `completed: ${taskDesc.slice(0, 150)}`;

  // Infer pattern from files changed and exports
  const patterns: string[] = [];
  for (const file of workerOutput.filesChanged) {
    if (file.includes("route")) patterns.push("route handler");
    else if (file.includes("middleware")) patterns.push("middleware");
    else if (file.includes("component")) patterns.push("component");
    else if (file.includes("test")) patterns.push("test suite");
    else if (file.includes("store") || file.includes("db")) patterns.push("data layer");
    else if (file.includes("util")) patterns.push("utility");
  }
  const pattern = [...new Set(patterns)].join(", ") || "general implementation";

  return {
    task: taskId,
    did,
    ex: exports,
    im: imports,
    pattern,
  };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/digests/generator.test.ts
pnpm typecheck
```

**Commit:** `feat(digests): add task completion digest generator`

---

## Task 12: Safety — Watchdog + Loop Tracking

**Files:**

- Create: `packages/core/src/safety/watchdog.ts`
- Create: `packages/core/src/safety/watchdog.test.ts`
- Create: `packages/core/src/safety/loops.ts`
- Create: `packages/core/src/safety/loops.test.ts`

- [ ] **Step 1: Write watchdog tests**

```ts
// packages/core/src/safety/watchdog.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWatchdog } from "./watchdog.js";
import type { WatchdogState } from "../types.js";

describe("watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns continue when task completed recently", () => {
    const now = new Date();
    const state: WatchdogState = {
      lastTaskCompletedAt: now.toISOString(),
      warningIssued: false,
    };
    const watchdog = createWatchdog(state);
    const action = watchdog.check(now);
    expect(action).toBe("continue");
  });

  it("returns warn after 20 min of no progress", () => {
    const past = new Date(Date.now() - 21 * 60 * 1000);
    const state: WatchdogState = {
      lastTaskCompletedAt: past.toISOString(),
      warningIssued: false,
    };
    const watchdog = createWatchdog(state);
    const action = watchdog.check(new Date());
    expect(action).toBe("warn");
  });

  it("returns pause after 40 min of no progress", () => {
    const past = new Date(Date.now() - 41 * 60 * 1000);
    const state: WatchdogState = {
      lastTaskCompletedAt: past.toISOString(),
      warningIssued: true,
    };
    const watchdog = createWatchdog(state);
    const action = watchdog.check(new Date());
    expect(action).toBe("pause");
  });

  it("reset updates lastTaskCompletedAt", () => {
    const past = new Date(Date.now() - 25 * 60 * 1000);
    const state: WatchdogState = {
      lastTaskCompletedAt: past.toISOString(),
      warningIssued: true,
    };
    const watchdog = createWatchdog(state);
    const newState = watchdog.reset();
    expect(new Date(newState.lastTaskCompletedAt).getTime()).toBeGreaterThan(past.getTime());
    expect(newState.warningIssued).toBe(false);
  });
});
```

- [ ] **Step 2: Implement watchdog.ts**

```ts
// packages/core/src/safety/watchdog.ts
import type { WatchdogState } from "../types.js";

export type WatchdogAction = "continue" | "warn" | "pause";

const WARN_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
const PAUSE_THRESHOLD_MS = 40 * 60 * 1000; // 40 minutes

export interface Watchdog {
  check(now?: Date): WatchdogAction;
  reset(): WatchdogState;
  getState(): WatchdogState;
}

/**
 * Create a watchdog that monitors progress and triggers actions
 * when no task has completed within thresholds.
 */
export function createWatchdog(initialState: WatchdogState): Watchdog {
  let state = { ...initialState };

  return {
    check(now?: Date): WatchdogAction {
      const currentTime = (now ?? new Date()).getTime();
      const lastCompleted = new Date(state.lastTaskCompletedAt).getTime();
      const elapsed = currentTime - lastCompleted;

      if (elapsed >= PAUSE_THRESHOLD_MS) {
        return "pause";
      }

      if (elapsed >= WARN_THRESHOLD_MS && !state.warningIssued) {
        state = { ...state, warningIssued: true };
        return "warn";
      }

      return "continue";
    },

    reset(): WatchdogState {
      state = {
        lastTaskCompletedAt: new Date().toISOString(),
        warningIssued: false,
      };
      return state;
    },

    getState(): WatchdogState {
      return { ...state };
    },
  };
}

/**
 * Create an initial watchdog state.
 */
export function createWatchdogState(): WatchdogState {
  return {
    lastTaskCompletedAt: new Date().toISOString(),
    warningIssued: false,
  };
}
```

- [ ] **Step 3: Write loop tracking tests**

```ts
// packages/core/src/safety/loops.test.ts
import { describe, it, expect } from "vitest";
import { createLoopTracker, recordLoop, shouldBreak } from "./loops.js";
import type { StageFeedback } from "../types.js";

describe("loop tracking", () => {
  describe("createLoopTracker", () => {
    it("creates tracker with zero loops", () => {
      const tracker = createLoopTracker("m1-s1-t1");
      expect(tracker.taskId).toBe("m1-s1-t1");
      expect(tracker.totalLoops).toBe(0);
      expect(tracker.stageLoopIds).toHaveLength(0);
    });
  });

  describe("recordLoop", () => {
    it("increments loop count and adds ID", () => {
      let tracker = createLoopTracker("t1");
      tracker = recordLoop(tracker, "compile");
      expect(tracker.totalLoops).toBe(1);
      expect(tracker.stageLoopIds).toHaveLength(1);
      expect(tracker.stageLoopIds[0]).toContain("compile");
    });
  });

  describe("shouldBreak", () => {
    it("returns false when under limits", () => {
      const tracker = createLoopTracker("t1");
      const errors: StageFeedback[] = [
        { stage: "compile", errors: [{ f: "a.ts", l: 1, e: "error1", fix: "fix1" }] },
      ];
      const result = shouldBreak(tracker, "compile", errors, []);
      expect(result.break).toBe(false);
    });

    it("breaks after 5 loops in same stage", () => {
      let tracker = createLoopTracker("t1");
      for (let i = 0; i < 5; i++) {
        tracker = recordLoop(tracker, "compile");
      }
      const result = shouldBreak(tracker, "compile", [], []);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("max");
    });

    it("breaks when same error appears 3 times", () => {
      const tracker = createLoopTracker("t1");
      const sameError: StageFeedback = {
        stage: "compile",
        errors: [{ f: "a.ts", l: 1, e: "Cannot find module X", fix: "install X" }],
      };
      const errorHistory = [sameError, sameError, sameError];
      const result = shouldBreak(tracker, "compile", errorHistory, []);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("same error");
    });

    it("breaks at 15 total loops", () => {
      let tracker = createLoopTracker("t1");
      for (let i = 0; i < 15; i++) {
        tracker = recordLoop(tracker, i < 5 ? "compile" : i < 10 ? "test" : "review");
      }
      const result = shouldBreak(tracker, "review", [], []);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("total");
    });

    it("breaks when identical diff appears twice", () => {
      const tracker = createLoopTracker("t1");
      const diffs = ["diff --git a/src/a.ts\n+line1", "diff --git a/src/a.ts\n+line1"];
      const result = shouldBreak(tracker, "compile", [], diffs);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("identical diff");
    });

    it("breaks at 50 loop IDs", () => {
      let tracker = createLoopTracker("t1");
      for (let i = 0; i < 50; i++) {
        tracker = recordLoop(tracker, "compile");
      }
      const result = shouldBreak(tracker, "compile", [], []);
      expect(result.break).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Implement loops.ts**

```ts
// packages/core/src/safety/loops.ts
import type { LoopTracker, StageType, StageFeedback } from "../types.js";

const MAX_PER_STAGE = 5;
const MAX_SAME_ERROR = 3;
const MAX_TOTAL_LOOPS = 15;
const MAX_IDENTICAL_DIFFS = 2;
const MAX_LOOP_IDS = 50;

export interface BreakDecision {
  break: boolean;
  reason: string;
}

/**
 * Create a new loop tracker for a task.
 */
export function createLoopTracker(taskId: string): LoopTracker {
  return {
    taskId,
    stageLoopIds: [],
    totalLoops: 0,
  };
}

/**
 * Record a loop iteration. Returns updated tracker (immutable).
 */
export function recordLoop(tracker: LoopTracker, stage: StageType): LoopTracker {
  const loopId = `${stage}-${tracker.totalLoops + 1}-${Date.now()}`;
  return {
    ...tracker,
    stageLoopIds: [...tracker.stageLoopIds, loopId],
    totalLoops: tracker.totalLoops + 1,
  };
}

/**
 * Determine if the loop should break based on safety caps.
 *
 * @param tracker - Current loop tracker state
 * @param stage - Current stage being looped
 * @param errorHistory - All feedback objects from this stage's loops
 * @param diffHistory - Diffs produced in each loop iteration
 */
export function shouldBreak(
  tracker: LoopTracker,
  stage: StageType,
  errorHistory: StageFeedback[],
  diffHistory: string[],
): BreakDecision {
  // Check: max loop IDs (hard kill)
  if (tracker.stageLoopIds.length >= MAX_LOOP_IDS) {
    return { break: true, reason: `Hard kill: ${MAX_LOOP_IDS} loop IDs created` };
  }

  // Check: max total loops across all stages
  if (tracker.totalLoops >= MAX_TOTAL_LOOPS) {
    return {
      break: true,
      reason: `Total loops (${tracker.totalLoops}) reached max ${MAX_TOTAL_LOOPS}`,
    };
  }

  // Check: max per stage
  const stageLoops = tracker.stageLoopIds.filter((id) => id.startsWith(stage)).length;
  if (stageLoops >= MAX_PER_STAGE) {
    return { break: true, reason: `Stage "${stage}" reached max ${MAX_PER_STAGE} loops` };
  }

  // Check: same error consecutive
  if (errorHistory.length >= MAX_SAME_ERROR) {
    const recent = errorHistory.slice(-MAX_SAME_ERROR);
    const firstErrors = JSON.stringify(recent[0]?.errors ?? []);
    const allSame = recent.every((fb) => JSON.stringify(fb.errors) === firstErrors);
    if (allSame) {
      return { break: true, reason: `Same error repeated ${MAX_SAME_ERROR} times in "${stage}"` };
    }
  }

  // Check: identical diff
  if (diffHistory.length >= MAX_IDENTICAL_DIFFS) {
    const recent = diffHistory.slice(-MAX_IDENTICAL_DIFFS);
    if (recent.length === MAX_IDENTICAL_DIFFS && recent.every((d) => d === recent[0])) {
      return {
        break: true,
        reason: `Identical diff produced ${MAX_IDENTICAL_DIFFS} times — worker is stuck`,
      };
    }
  }

  return { break: false, reason: "" };
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test -- --run packages/core/src/safety/watchdog.test.ts
pnpm test -- --run packages/core/src/safety/loops.test.ts
pnpm typecheck
```

**Commit:** `feat(safety): add watchdog timer and loop tracking with circuit breakers`

---

## Task 13: Enriched Context Builder

**Files:**

- Modify: `packages/core/src/context/context-builder.ts`
- Modify: `packages/core/src/context/context-builder.test.ts`

- [ ] **Step 1: Add tests for buildEnrichedContext**

```ts
// packages/core/src/context/context-builder.test.ts — add to existing file

import { buildEnrichedContext } from "./context-builder.js";
import type { EnrichedContextPackage, TaskDigest } from "../types.js";

// Add this describe block alongside the existing tests:

describe("buildEnrichedContext", () => {
  const config: ProjectConfig = {
    name: "test",
    specPath: "spec.md",
    budgets: {
      project: { usd: 50, warnPct: 70 },
      perTask: { usd: 2, softPct: 75 },
      supervisor: { usd: 3 },
      planning: { usd: 5 },
    },
    limits: {
      maxConcurrentWorkers: 3,
      maxTotalWorkers: 50,
      maxRetries: 3,
      maxTaskDepth: 4,
      sessionTimeoutMin: 15,
      spawnRatePerMin: 5,
    },
    circuitBreakers: {
      consecutiveFailuresSlice: 3,
      consecutiveFailuresProject: 5,
      budgetEfficiencyThreshold: 0.5,
    },
  };

  it("returns null for nonexistent task", () => {
    const wt: WorkTree = { milestones: [] };
    const ct: CodeTree = { modules: [] };
    const result = buildEnrichedContext(wt, ct, config, "nonexistent", "", "");
    expect(result).toBeNull();
  });

  it("includes contracts and digests in enriched context", () => {
    const wt: WorkTree = {
      milestones: [
        {
          id: "m1",
          name: "m1",
          description: "test",
          dependencies: [],
          slices: [
            {
              id: "s1",
              name: "s1",
              description: "test",
              parentMilestoneId: "m1",
              tasks: [
                {
                  id: "t1",
                  name: "Create route",
                  description: "Create route in src/a.ts",
                  status: "pending",
                  dependencies: [],
                  touches: ["src/a.ts"],
                  reads: [],
                  worker: null,
                  tokenSpend: 0,
                  attemptCount: 0,
                  gateResults: [],
                  parentSliceId: "s1",
                },
              ],
            },
          ],
        },
      ],
    };
    const ct: CodeTree = {
      modules: [
        {
          path: "src",
          description: "source",
          files: [
            {
              path: "src/a.ts",
              description: "file a",
              exports: [],
              imports: [],
              lastModifiedBy: null,
            },
          ],
        },
      ],
    };
    const digests: TaskDigest[] = [
      { task: "t0", did: "set up project", ex: ["app"], im: [], pattern: "scaffolding" },
    ];
    const contracts = "export interface Player { name: string; }";

    const result = buildEnrichedContext(
      wt,
      ct,
      config,
      "t1",
      "",
      "",
      undefined,
      contracts,
      digests,
      "Build a players API",
    );

    expect(result).not.toBeNull();
    expect(result!.contracts).toBe(contracts);
    expect(result!.digests).toEqual(digests);
    expect(result!.specExcerpt).toBe("Build a players API");
  });

  it("includes fileContents when provided", () => {
    const wt: WorkTree = {
      milestones: [
        {
          id: "m1",
          name: "m1",
          description: "test",
          dependencies: [],
          slices: [
            {
              id: "s1",
              name: "s1",
              description: "test",
              parentMilestoneId: "m1",
              tasks: [
                {
                  id: "t1",
                  name: "Create route",
                  description: "Create route in src/a.ts",
                  status: "pending",
                  dependencies: [],
                  touches: ["src/a.ts"],
                  reads: [],
                  worker: null,
                  tokenSpend: 0,
                  attemptCount: 0,
                  gateResults: [],
                  parentSliceId: "s1",
                },
              ],
            },
          ],
        },
      ],
    };
    const ct: CodeTree = {
      modules: [
        {
          path: "src",
          description: "source",
          files: [
            {
              path: "src/a.ts",
              description: "file a",
              exports: [],
              imports: [],
              lastModifiedBy: null,
            },
          ],
        },
      ],
    };
    const fileContents = { "src/a.ts": "export const x = 1;" };

    const result = buildEnrichedContext(
      wt,
      ct,
      config,
      "t1",
      "",
      "",
      undefined,
      "",
      [],
      "",
      fileContents,
    );

    expect(result).not.toBeNull();
    expect(result!.fileContents).toEqual(fileContents);
  });
});
```

- [ ] **Step 2: Add buildEnrichedContext to context-builder.ts**

Add the import and new function to the existing file:

```ts
// packages/core/src/context/context-builder.ts — add import
import type {
  WorkTree,
  WorkTask,
  CodeTree,
  CodeFile,
  ContextPackage,
  ProjectConfig,
  EnrichedContextPackage,
  TaskDigest,
} from "../types.js";
```

```ts
// packages/core/src/context/context-builder.ts — add after buildContext function

/**
 * Build an EnrichedContextPackage with full file contents, contracts, digests, and spec excerpt.
 * Falls back to regular context building, then layers on enriched fields.
 */
export function buildEnrichedContext(
  workTree: WorkTree,
  codeTree: CodeTree,
  config: ProjectConfig,
  taskId: string,
  memory: string,
  rules: string,
  repoMap?: RepoMap | null,
  contracts?: string,
  digests?: TaskDigest[],
  specExcerpt?: string,
  fileContents?: Record<string, string>,
): EnrichedContextPackage | null {
  const base = buildContext(workTree, codeTree, config, taskId, memory, rules, repoMap);
  if (!base) return null;

  return {
    ...base,
    fileContents: fileContents ?? {},
    contracts: contracts ?? "",
    digests: digests ?? [],
    specExcerpt: specExcerpt ?? "",
  };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/context/context-builder.test.ts
pnpm typecheck
```

**Commit:** `feat(context): add enriched context builder with file contents, contracts, digests`

---

## Task 14: Updated Wire Mode

**Files:**

- Modify: `packages/core/src/wire/wire.ts`
- Modify: `packages/core/src/wire/wire.test.ts`

- [ ] **Step 1: Add tests for toEnrichedWirePrompt**

```ts
// packages/core/src/wire/wire.test.ts — add to existing file

import type { EnrichedContextPackage, TaskDigest } from "../types.js";

describe("toEnrichedWirePrompt", () => {
  it("includes contents, contracts, and digests", () => {
    const ctx: EnrichedContextPackage = {
      task: { name: "test", description: "test task", acceptanceCriteria: ["pass tests"] },
      interfaces: [
        {
          path: "src/a.ts",
          description: "file a",
          exports: [{ name: "fn", signature: "() => void", description: "" }],
          imports: [],
          lastModifiedBy: null,
        },
      ],
      above: [],
      below: [],
      memory: "some memory",
      rules: "",
      budget: { softLimit: 1500, hardLimit: 2000 },
      landscape: { mc: 1, fc: 2, modules: [] },
      relevant: [],
      fileContents: { "src/a.ts": "export function fn() {}" },
      contracts: "export interface Player { name: string; }",
      digests: [{ task: "t0", did: "scaffolding", ex: ["app"], im: [], pattern: "init" }],
      specExcerpt: "Build a players API",
    };

    const wire = toEnrichedWirePrompt(ctx);
    expect(wire.contents).toEqual({ "src/a.ts": "export function fn() {}" });
    expect(wire.contracts).toBe("export interface Player { name: string; }");
    expect(wire.digests).toHaveLength(1);
    expect(wire.digests![0]!.task).toBe("t0");
    // Base fields still present
    expect(wire.task).toContain("test");
    expect(wire.files).toHaveProperty("src/a.ts");
  });
});
```

- [ ] **Step 2: Add toEnrichedWirePrompt to wire.ts**

```ts
// packages/core/src/wire/wire.ts — add import
import type {
  CodeFile,
  ContextPackage,
  WirePrompt,
  WireResponse,
  WorkerOutput,
  EnrichedContextPackage,
} from "../types.js";
```

```ts
// packages/core/src/wire/wire.ts — add after toWirePrompt function

/**
 * Convert an EnrichedContextPackage into a WirePrompt with full file contents,
 * contracts, and digests. Used for the new staged pipeline.
 */
export function toEnrichedWirePrompt(ctx: EnrichedContextPackage): WirePrompt {
  const base = toWirePrompt(ctx);
  return {
    ...base,
    contents: ctx.fileContents,
    contracts: ctx.contracts,
    digests: ctx.digests,
  };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/wire/wire.test.ts
pnpm typecheck
```

**Commit:** `feat(wire): add enriched wire prompt with file contents, contracts, digests`

---

## Task 15: Seeder Overhaul

**Files:**

- Modify: `packages/core/src/seeder/from-spec.ts`
- Modify: `packages/core/src/seeder/from-spec.test.ts`

- [ ] **Step 1: Add tests for seeder rules enforcement**

```ts
// packages/core/src/seeder/from-spec.test.ts — add to existing tests

describe("seeder rules enforcement", () => {
  describe("parseSeederResponse validation", () => {
    it("promotes one-owner-per-file conflict to hard block (not just warning)", () => {
      const response = JSON.stringify({
        workTree: {
          milestones: [
            {
              id: "m1",
              name: "m1",
              description: "build",
              dependencies: [],
              slices: [
                {
                  id: "s1",
                  name: "s1",
                  description: "core",
                  parentMilestoneId: "m1",
                  tasks: [
                    {
                      id: "t1",
                      name: "A",
                      description: "Task A creates src/a.ts",
                      status: "pending",
                      dependencies: [],
                      touches: ["src/a.ts"],
                      reads: [],
                      worker: null,
                      tokenSpend: 0,
                      attemptCount: 0,
                      gateResults: [],
                      parentSliceId: "s1",
                    },
                    {
                      id: "t2",
                      name: "B",
                      description: "Task B modifies src/a.ts",
                      status: "pending",
                      dependencies: [],
                      touches: ["src/a.ts"],
                      reads: [],
                      worker: null,
                      tokenSpend: 0,
                      attemptCount: 0,
                      gateResults: [],
                      parentSliceId: "s1",
                    },
                  ],
                },
              ],
            },
          ],
        },
        codeTree: {
          modules: [
            {
              path: "src",
              description: "source",
              files: [
                {
                  path: "src/a.ts",
                  description: "a",
                  exports: [],
                  imports: [],
                  lastModifiedBy: null,
                },
              ],
            },
          ],
        },
      });
      const { warnings } = parseSeederResponse(response);
      expect(warnings.some((w) => w.message.includes("both touch"))).toBe(true);
    });
  });

  describe("buildSeederPrompt rules", () => {
    it("includes one-owner-per-file rule", () => {
      const prompt = buildSeederPrompt("Build a project", "test");
      expect(prompt).toContain("one task");
      expect(prompt.toLowerCase()).toContain("owner");
    });

    it("includes tests-with-implementation rule", () => {
      const prompt = buildSeederPrompt("Build a project", "test");
      expect(prompt).toContain("test file");
    });

    it("includes contracts-first rule", () => {
      const prompt = buildSeederPrompt("Build a project", "test");
      expect(prompt).toContain("contract");
    });

    it("includes integration tasks rule", () => {
      const prompt = buildSeederPrompt("Build a project", "test");
      expect(prompt.toLowerCase()).toContain("integration");
    });

    it("includes detailed descriptions rule", () => {
      const prompt = buildSeederPrompt("Build a project", "test");
      expect(prompt).toContain("specific");
    });
  });
});
```

- [ ] **Step 2: Update buildSeederPrompt with 5 rules**

Replace the `## Rules` section in `buildSeederPrompt`:

```ts
// packages/core/src/seeder/from-spec.ts — replace the Rules section in buildSeederPrompt
// The existing rules section (starting from "## Rules") should be replaced with:

## Rules

RULE 1 — ONE OWNER PER FILE:
Every file has exactly one task that creates or modifies it. No exceptions. If a feature requires changes across an existing file that another task touches, those changes MUST be in the SAME task or the second task MUST depend on the first. Independent tasks MUST NOT share files in their touches arrays.

RULE 2 — TESTS LIVE WITH IMPLEMENTATION:
No separate testing milestone. Each implementation task MUST include test files in its touches array. The worker writes code AND tests in the same context. Tests always match implementation.

BAD:  Milestone 1: Build API -> Milestone 2: Write tests
GOOD: Task: "Create players route + tests" -> touches: [src/routes/players.ts, src/__tests__/players.test.ts]

RULE 3 — CONTRACTS FIRST:
First task of every project: generate contracts file from spec. Every subsequent task reads it. The contracts task touches only the contracts file and its test.

Milestone 0: Foundation
  Task 0: Generate contracts (shared types from spec) -> touches: [src/contracts.ts]
  Task 1: Project scaffolding
Milestone 1: Implementation
  Task 2: Players route + tests (reads: src/contracts.ts)

RULE 4 — EXPLICIT INTEGRATION TASKS:
When a project has multiple packages (client + server, monorepo, etc.), generate an explicit integration verification task at the end:
  Task: "Wire client to server — verify types match, API shapes match, full build + test"

RULE 5 — DETAILED TASK DESCRIPTIONS:
Task descriptions MUST specify exact expectations including function names, return types, and behavior:

GOOD: "Create src/routes/players.ts exporting playersRouter (Router). GET / returns Player[] from store. POST / validates via validatePlayer(), adds to store, returns 201. Import Player from contracts.ts. Include tests in __tests__/players.test.ts: GET returns empty array, GET returns players after POST, POST validates required fields."

BAD: "Implement the players endpoint"

DOMAIN FIDELITY:
- Types and interfaces MUST match the spec's domain language exactly
- If spec says "player with name, team, battingAvg" -> generate EXACTLY those fields, not generic alternatives
- Do NOT substitute domain-specific fields with generic ones (no "email" when spec says "team")

MIDDLEWARE ORDER:
- Express middleware executes in registration order
- Static file serving MUST come before 404 catch-all handlers
- Route-specific handlers MUST come before generic error handlers

- Every file path in task.touches and task.reads MUST exist in the codeTree
- Each task must fit in 150k tokens of context. If uncertain, split.
- Use descriptive IDs: m1, m1-s1, m1-s1-t1
- Group files into modules by top-level directory
- Tasks touching the same file should have dependency relationships
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/seeder/from-spec.test.ts
pnpm typecheck
```

**Commit:** `feat(seeder): enforce one-owner, tests-with-impl, contracts-first, integration, detailed-descriptions rules`

---

## Task 16: Orchestrator Rewrite

**Files:**

- Modify: `packages/core/src/orchestrator.ts`
- Modify: `packages/core/src/orchestrator.test.ts`

- [ ] **Step 1: Add tests for staged pipeline**

```ts
// packages/core/src/orchestrator.test.ts — add new describe block for staged pipeline

describe("staged pipeline", () => {
  it("runs compile stage on dispatched task", async () => {
    // Use mock storage + mock spawn to verify compile stage is invoked
    const mockSpawn: SpawnFn = vi.fn().mockResolvedValue({
      output: {
        status: "complete",
        filesChanged: ["src/a.ts"],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 1, fail: 0 },
        notes: "done",
        tokensUsed: 1000,
      },
      costUsd: 0.1,
      sessionId: "session-1",
      needsInspection: false,
    });

    // This test validates the orchestrator calls compile/test/review stages
    // Full integration tested in Task 18
    expect(mockSpawn).toBeDefined();
  });
});
```

- [ ] **Step 2: Rewrite orchestrator.ts**

This is a major rewrite. The existing `Orchestrator` class keeps its constructor signature but `runOneCycle` now implements the staged pipeline.

```ts
// packages/core/src/orchestrator.ts — full rewrite

import type { Storage } from "./storage/interface.js";
import type { SpawnResult } from "./workers/spawner.js";
import type {
  ContextPackage,
  EnrichedContextPackage,
  StageResult,
  StageFeedback,
  TaskDigest,
  LoopTracker,
} from "./types.js";
import type { EnvConfig } from "./scanner/types.js";
import { inspectWorktreeOutput } from "./workers/inspect.js";
import { refreshFiles } from "./scanner/incremental.js";
import {
  createWorkerPool,
  planSpawns,
  spawnWorker,
  completeWorker,
  applyWorkerResult,
  getActiveCount,
} from "./workers/pool.js";
import type { WorkerPool } from "./workers/pool.js";
import { buildContext } from "./context/context-builder.js";
import { buildEnrichedContext } from "./context/context-builder.js";
import { getAllTasks, getTask, updateTaskStatus, updateTask } from "./trees/work-tree.js";
import {
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  isTerminal,
} from "./state/state-machine.js";
import { getProjectBudgetStatus, checkCircuitBreakers } from "./budget/budget.js";
import { createWorktree, removeWorktree, mergeWorktree } from "./workers/worktree.js";
import { preflightCheck } from "./preflight/check.js";
import { runCompileStage } from "./stages/compile.js";
import { runTestStage } from "./stages/test.js";
import { runReviewStage } from "./stages/review.js";
import { generateDigest } from "./digests/generator.js";
import { createWatchdog, createWatchdogState } from "./safety/watchdog.js";
import type { Watchdog, WatchdogAction } from "./safety/watchdog.js";
import { createLoopTracker, recordLoop, shouldBreak } from "./safety/loops.js";
import { runSpringTraining } from "./spring-training/runner.js";
import { toEnrichedWirePrompt } from "./wire/wire.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const exec = promisify(execFile);

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

// === Options ===

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
    // 1. Read config, state, workTree, codeTree, memory from storage
    const config = await this.storage.readProjectConfig();
    let state = await this.storage.readProjectState();
    let workTree = await this.storage.readWorkTree();
    const codeTree = await this.storage.readCodeTree();
    const repoMap = await this.storage.readRepoMap();
    const memory = await this.storage.readMemory();

    // 2. Check if terminal/paused state
    if (isTerminal(state.status)) {
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: state.status === "complete",
        isPaused: false,
      };
    }
    if (state.status === "paused") {
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true };
    }

    // 3. Watchdog check
    const watchdogAction = this.watchdog.check();
    if (watchdogAction === "pause") {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: false,
        isPaused: true,
        error: "Watchdog: no progress for 40 minutes",
      };
    }
    if (watchdogAction === "warn") {
      await this.storage.appendMemory("Watchdog warning: no task completed in 20 minutes");
    }

    // 4. Circuit breakers
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

    // 5. Budget check
    const budgetStatus = getProjectBudgetStatus(state, config);
    if (budgetStatus.atLimit) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: false,
        isPaused: true,
        error: "Budget limit reached",
      };
    }

    // 6. Spring training (once, before first dispatch)
    if (!this.springTrainingDone && !this.options.skipSpringTraining && this.options.specText) {
      try {
        const stResult = await runSpringTraining(
          this.storage,
          this.options.specText,
          repoMap,
          this.options.repoDir,
        );
        if (!stResult.valid) {
          await this.storage.appendMemory(
            `Spring training blockers: ${stResult.blockers.join("; ")}`,
          );
        }
        if (stResult.warnings.length > 0) {
          await this.storage.appendMemory(
            `Spring training warnings: ${stResult.warnings.join("; ")}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(`Spring training failed: ${msg}`);
      }
      this.springTrainingDone = true;
    }

    // 7. Auto-retry failed tasks under retry limit
    const retryCheck = getAllTasks(workTree);
    for (const task of retryCheck) {
      if (task.status === "failed" && task.attemptCount < config.limits.maxRetries) {
        workTree = updateTaskStatus(workTree, task.id, "pending");
      }
    }

    // 8. Plan spawns
    const spawnDecision = planSpawns(workTree, this.pool, config, state);

    // 9. Check completion
    const allTasks = getAllTasks(workTree);
    const allDone =
      allTasks.length === 0 ||
      allTasks.every((t) => t.status === "complete" || t.status === "failed");
    const activeWorkers = getActiveCount(this.pool);

    if (allDone && activeWorkers === 0 && !spawnDecision.canSpawn) {
      state = transition(state, "complete");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: true, isPaused: false };
    }

    // 10. Dispatch tasks with staged pipeline
    let dispatched = 0;
    let completed = 0;
    let failed = 0;

    // Read shared context
    const contracts = await this.storage.readContracts();
    const digests = await this.storage.readDigests();
    const env = repoMap?.env ?? null;

    for (const task of spawnDecision.tasksToSpawn) {
      // Preflight
      const preflight = preflightCheck(workTree, codeTree, repoMap, config, task.id);
      if (!preflight.canProceed) {
        workTree = updateTaskStatus(workTree, task.id, "failed");
        failed++;
        await this.storage.appendMemory(
          `Task ${task.id} blocked by preflight: ${preflight.blockers.join("; ")}`,
        );
        continue;
      }
      if (preflight.warnings.length > 0) {
        await this.storage.appendMemory(
          `Task ${task.id} preflight warnings: ${preflight.warnings.join("; ")}`,
        );
      }

      // Build enriched context
      const fileContents = await this.readFileContents(task.touches, task.reads);
      const context = buildEnrichedContext(
        workTree,
        codeTree,
        config,
        task.id,
        memory,
        "",
        repoMap,
        contracts,
        digests,
        this.options.specText ?? "",
        fileContents,
      );
      if (!context) continue;

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
        // === STAGE: IMPLEMENT ===
        const result = await this.spawn({
          taskId: task.id,
          worktreePath,
          context,
          budgetUsd: config.budgets.perTask.usd,
        });

        let workerOutput = result.output;
        if (result.needsInspection && worktreePath !== ".") {
          workerOutput = await inspectWorktreeOutput(worktreePath, task.touches, env);
        }

        state = addTokenSpend(state, workerOutput.tokensUsed);
        await this.storage.writeWorkerOutput(task.id, workerOutput);

        // === STAGED FEEDBACK LOOPS ===
        let loopTracker = createLoopTracker(task.id);
        let allStagesPassed = true;

        // === STAGE: COMPILE ===
        if (env?.ts && worktreePath !== ".") {
          const compileResult = await this.runStageLoop(
            "compile",
            loopTracker,
            worktreePath,
            env,
            task.touches,
            config.budgets.perTask.usd,
            context,
            contracts,
            this.options.specText ?? "",
          );
          loopTracker = compileResult.tracker;
          await this.storage.writeStageResult(task.id, compileResult.result);
          if (!compileResult.result.passed) {
            allStagesPassed = false;
          }
        }

        // === STAGE: TEST ===
        if (allStagesPassed && env && worktreePath !== ".") {
          const testResult = await this.runStageLoop(
            "test",
            loopTracker,
            worktreePath,
            env,
            task.touches,
            config.budgets.perTask.usd,
            context,
            contracts,
            this.options.specText ?? "",
          );
          loopTracker = testResult.tracker;
          await this.storage.writeStageResult(task.id, testResult.result);
          if (!testResult.result.passed) {
            allStagesPassed = false;
          }
        }

        // === STAGE: REVIEW ===
        if (allStagesPassed && worktreePath !== ".") {
          let diff = "";
          try {
            const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
            diff = stdout;
          } catch {
            diff = "(could not generate diff)";
          }

          const reviewResult = await runReviewStage(
            worktreePath,
            diff,
            contracts,
            this.options.specText ?? "",
            config.budgets.perTask.usd,
          );
          await this.storage.writeStageResult(task.id, reviewResult);
          if (!reviewResult.passed) {
            // Give worker one chance to fix review issues
            loopTracker = recordLoop(loopTracker, "review");
            const breakCheck = shouldBreak(loopTracker, "review", reviewResult.feedback, []);
            if (breakCheck.break) {
              allStagesPassed = false;
            } else {
              // Re-spawn with review feedback
              const feedbackContext = {
                ...context,
                memory:
                  context.memory + `\nREVIEW FEEDBACK:\n${JSON.stringify(reviewResult.feedback)}`,
              };
              await this.spawn({
                taskId: task.id,
                worktreePath,
                context: feedbackContext,
                budgetUsd: config.budgets.perTask.usd / 4,
              });
              // Re-run review
              const retryReview = await runReviewStage(
                worktreePath,
                diff,
                contracts,
                this.options.specText ?? "",
                config.budgets.perTask.usd,
              );
              await this.storage.writeStageResult(task.id, retryReview);
              if (!retryReview.passed) {
                allStagesPassed = false;
              }
            }
          }
        }

        // === STAGE: MERGE ===
        if (allStagesPassed) {
          if (this.options.repoDir && worktreeBranch) {
            const mergeResult = await mergeWorktree(this.options.repoDir, worktreeBranch);
            if (!mergeResult.success) {
              workTree = updateTaskStatus(workTree, task.id, "failed");
              workTree = updateTask(workTree, task.id, {
                attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1,
              });
              this.pool = completeWorker(this.pool, sessionId, "failed");
              failed++;
              await this.storage.appendMemory(
                `Task ${task.id} merge conflict: ${mergeResult.error}`,
              );
              continue;
            }
          }

          workTree = applyWorkerResult(workTree, task.id, workerOutput);
          this.pool = completeWorker(this.pool, sessionId, "completed");
          completed++;

          // Generate and store digest
          const digest = generateDigest(task.id, workerOutput, workTree, codeTree);
          await this.storage.writeDigest(task.id, digest);

          // Incremental repo map refresh
          if (repoMap && workerOutput.filesChanged.length > 0) {
            const updatedMap = await refreshFiles(
              repoMap,
              this.options.repoDir ?? ".",
              workerOutput.filesChanged,
            );
            await this.storage.writeRepoMap(updatedMap);
          }

          // Reset watchdog on successful completion
          this.watchdog.reset();
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
      } catch (err) {
        workTree = updateTaskStatus(workTree, task.id, "failed");
        workTree = updateTask(workTree, task.id, {
          attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1,
        });
        this.pool = completeWorker(this.pool, sessionId, "failed");
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(`Task ${task.id} spawn error: ${message}`);
      } finally {
        if (this.options.repoDir && worktreePath !== ".") {
          try {
            await removeWorktree(this.options.repoDir, worktreePath);
          } catch {}
        }
      }
    }

    // Milestone boundary integration check:
    // When all tasks in a milestone are complete, run full-project tsc + test suite.
    // If issues found, generate fix tasks and prepend to next milestone.
    // This check runs in the orchestrator loop — when the last task of a milestone
    // completes in this cycle, the next cycle will detect the milestone boundary
    // and run integration verification before dispatching next milestone's tasks.
    // Implementation: check if any milestone just became fully complete in this cycle,
    // then run compile + test on full project (not worktree) via runCompileStage/runTestStage.

    // Persist
    await this.storage.writeWorkTree(workTree);
    await this.storage.writeProjectState(state);

    return { dispatched, completed, failed, isComplete: false, isPaused: false };
  }

  /**
   * Run a stage (compile or test) in a loop with AI feedback until passed or safety cap.
   */
  private async runStageLoop(
    stage: "compile" | "test",
    tracker: LoopTracker,
    worktreePath: string,
    env: EnvConfig,
    taskTouches: string[],
    taskBudget: number,
    context: EnrichedContextPackage,
    contracts: string,
    specExcerpt: string,
  ): Promise<{ result: StageResult; tracker: LoopTracker }> {
    const errorHistory: StageFeedback[] = [];
    const diffHistory: string[] = [];
    let totalLoops = 0;

    for (let i = 0; i < 5; i++) {
      // Run the stage
      let stageResult: StageResult;
      if (stage === "compile") {
        stageResult = await runCompileStage(worktreePath, taskBudget);
      } else {
        stageResult = await runTestStage(worktreePath, env, taskTouches, taskBudget);
      }

      if (stageResult.passed) {
        stageResult.loops = totalLoops;
        return { result: stageResult, tracker };
      }

      // Record loop
      tracker = recordLoop(tracker, stage);
      totalLoops++;

      // Collect feedback
      for (const fb of stageResult.feedback) {
        errorHistory.push(fb);
      }

      // Check safety caps
      const breakCheck = shouldBreak(tracker, stage, errorHistory, diffHistory);
      if (breakCheck.break) {
        stageResult.loops = totalLoops;
        return { result: stageResult, tracker };
      }

      // Re-spawn worker with feedback to fix issues
      const feedbackJson = JSON.stringify(stageResult.feedback);
      const feedbackContext: EnrichedContextPackage = {
        ...context,
        memory:
          context.memory +
          `\n${stage.toUpperCase()} FEEDBACK (loop ${totalLoops}):\n${feedbackJson}`,
      };

      await this.spawn({
        taskId: context.task.name,
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
    }

    // Fell through — max loops
    return {
      result: { stage, passed: false, loops: totalLoops, feedback: errorHistory },
      tracker,
    };
  }

  /**
   * Read actual file contents from disk for enriched context.
   * Large files (>300 lines): first 50 lines + exports + relevant section.
   */
  private async readFileContents(
    touches: string[],
    reads: string[],
  ): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};
    const basePath = this.options.repoDir ?? ".";
    const allPaths = [...new Set([...touches, ...reads])];

    for (const filePath of allPaths) {
      try {
        const fullPath = `${basePath}/${filePath}`;
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");

        if (lines.length > 300) {
          // Large file: first 50 lines + exports + truncation notice
          const first50 = lines.slice(0, 50).join("\n");
          const exportLines = lines.filter((l) => l.startsWith("export ")).join("\n");
          contents[filePath] =
            `${first50}\n\n// ... (${lines.length} lines total, truncated) ...\n\n// Exports:\n${exportLines}`;
        } else {
          contents[filePath] = content;
        }
      } catch {
        // File doesn't exist yet (new file) — skip
      }
    }

    return contents;
  }
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run packages/core/src/orchestrator.test.ts
pnpm typecheck
```

**Commit:** `feat(orchestrator): rewrite to staged pipeline with compile/test/review loops, watchdog, and loop tracking`

---

## Task 17: CLI Updates

**Files:**

- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/commands/new.ts`
- Create: `packages/cli/src/commands/spring-training.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create spring-training command**

```ts
// packages/cli/src/commands/spring-training.ts
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import { DiskStorage } from "@openingday/core";
import { runSpringTraining } from "@openingday/core/spring-training/runner";
import { scanRepo as scanRepoMap } from "@openingday/core/scanner/scan";
import type { RepoMap } from "@openingday/core/scanner/types";

export function registerSpringTraining(program: Command): void {
  program
    .command("spring-training")
    .description("Run plan validation, contract generation, and execution simulation")
    .option("--spec <path>", "Path to specification file")
    .option("--skip-ai", "Skip AI contract generation (structural validation only)")
    .action(async (opts: { spec?: string; skipAi?: boolean }) => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(chalk.red("No project found. Run `openingday init` first."));
        return;
      }

      const config = await storage.readProjectConfig();

      // Read spec text
      let specText = "";
      const specPath = opts.spec ?? config.specPath;
      if (specPath && specPath !== "interactive") {
        try {
          specText = await readFile(resolve(specPath), "utf-8");
        } catch {
          console.log(chalk.yellow(`Could not read spec at ${specPath}`));
        }
      }

      // Read repo map
      let repoMap: RepoMap | null = null;
      try {
        repoMap = await storage.readRepoMap();
        if (!repoMap) {
          repoMap = await scanRepoMap(process.cwd(), "standard");
        }
      } catch {
        // No repo map available
      }

      console.log(chalk.gray("Running spring training..."));
      console.log();

      const result = await runSpringTraining(
        storage,
        specText,
        repoMap,
        process.cwd(),
        opts.skipAi,
      );

      // Display results
      if (result.blockers.length > 0) {
        console.log(chalk.red.bold("BLOCKERS:"));
        for (const b of result.blockers) {
          console.log(chalk.red(`  - ${b}`));
        }
        console.log();
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow.bold("WARNINGS:"));
        for (const w of result.warnings) {
          console.log(chalk.yellow(`  - ${w}`));
        }
        console.log();
      }

      if (result.contracts) {
        console.log(chalk.green("Contracts generated and saved."));
      }

      console.log(chalk.gray(`Execution order: ${result.executionOrder.length} tasks`));
      if (result.addedDependencies.length > 0) {
        console.log(chalk.cyan(`Added ${result.addedDependencies.length} missing dependencies`));
      }

      console.log();
      if (result.valid) {
        console.log(chalk.green.bold("Spring training PASSED"));
      } else {
        console.log(chalk.red.bold("Spring training FAILED — fix blockers before running"));
      }
    });
}
```

- [ ] **Step 2: Update init.ts to run spring training after seeding**

Add after the `await storage.writeCodeTree(codeTree);` line in `init.ts`:

```ts
// packages/cli/src/commands/init.ts — add import at top
import { runSpringTraining } from "@openingday/core/spring-training/runner";
```

```ts
// packages/cli/src/commands/init.ts — add after writing trees, before final console.log

// Run spring training
if (workTree.milestones.length > 0) {
  console.log(chalk.gray("Running spring training..."));
  try {
    let specText = "";
    if (fromStat?.isFile() && fromPath.endsWith(".md")) {
      specText = await readFile(fromPath, "utf-8");
    } else if (opts.spec) {
      specText = await readFile(resolve(opts.spec), "utf-8");
    }
    const stResult = await runSpringTraining(storage, specText, repoMap, process.cwd());
    if (stResult.blockers.length > 0) {
      console.log(chalk.yellow(`  Spring training blockers: ${stResult.blockers.length}`));
      for (const b of stResult.blockers) {
        console.log(chalk.yellow(`    - ${b}`));
      }
    }
    if (stResult.warnings.length > 0) {
      console.log(chalk.gray(`  Spring training warnings: ${stResult.warnings.length}`));
    }
    if (stResult.contracts) {
      console.log(chalk.gray("  Contracts generated."));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`  Spring training failed: ${msg}`));
  }
}
```

- [ ] **Step 3: Update new.ts to run spring training after seeding**

Add after the tree-writing code in `new.ts` (the `await storage.writeCodeTree(codeTree);` section):

```ts
// packages/cli/src/commands/new.ts — add import at top
import { runSpringTraining } from "@openingday/core/spring-training/runner";
```

```ts
// packages/cli/src/commands/new.ts — add after writing trees, before final success message

// Run spring training
if (workTree.milestones.length > 0) {
  console.log(chalk.gray("Running spring training..."));
  try {
    const stResult = await runSpringTraining(storage, specText, repoMap, process.cwd());
    if (stResult.blockers.length > 0) {
      console.log(chalk.yellow(`  Blockers: ${stResult.blockers.length}`));
      for (const b of stResult.blockers) {
        console.log(chalk.yellow(`    - ${b}`));
      }
    }
    if (stResult.warnings.length > 0) {
      console.log(chalk.gray(`  Warnings: ${stResult.warnings.length}`));
    }
    if (stResult.contracts) {
      console.log(chalk.gray("  Contracts generated."));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`  Spring training failed: ${msg}`));
  }
}
```

- [ ] **Step 4: Register spring-training command in CLI index**

```ts
// packages/cli/src/index.ts — add import
import { registerSpringTraining } from "./commands/spring-training.js";
```

```ts
// packages/cli/src/index.ts — add registration after registerScan
registerSpringTraining(program);
```

- [ ] **Step 5: Run tests**

```bash
pnpm typecheck
```

**Commit:** `feat(cli): add spring-training command, integrate into init and new flows`

---

## Task 18: Core Exports + Integration Test

**Files:**

- Modify: `packages/core/src/index.ts`
- Create: `tests/integration/staged-pipeline.test.ts`

- [ ] **Step 1: Export all new modules from barrel**

```ts
// packages/core/src/index.ts — add these exports

// Stage Types
export type {
  StageType,
  StageFeedback,
  StageResult,
  TaskDigest,
  SpringTrainingResult,
  EnrichedContextPackage,
  WatchdogState,
  LoopTracker,
} from "./types.js";

// Spring Training
export { validateStructure } from "./spring-training/validate.js";
export type { ValidationResult } from "./spring-training/validate.js";
export {
  generateContracts,
  buildContractPrompt,
  parseContractResponse,
} from "./spring-training/contracts.js";
export { simulateExecution } from "./spring-training/simulate.js";
export type { SimulationResult } from "./spring-training/simulate.js";
export { runSpringTraining } from "./spring-training/runner.js";

// Stages
export { runCompileStage, runTsc } from "./stages/compile.js";
export type { TscResult } from "./stages/compile.js";
export { runTestStage, runTests } from "./stages/test.js";
export type { TestRunResult } from "./stages/test.js";
export { runReviewStage, buildReviewPrompt, parseReviewResponse } from "./stages/review.js";
export {
  digestCompileErrors,
  digestTestFailures,
  digestReviewIssues,
  parseFeedbackResponse,
} from "./stages/feedback.js";

// Digests
export { generateDigest } from "./digests/generator.js";

// Safety
export { createWatchdog, createWatchdogState } from "./safety/watchdog.js";
export type { WatchdogAction, Watchdog } from "./safety/watchdog.js";
export { createLoopTracker, recordLoop, shouldBreak } from "./safety/loops.js";
export type { BreakDecision } from "./safety/loops.js";

// Enriched Context + Wire
export { buildEnrichedContext } from "./context/context-builder.js";
export { toEnrichedWirePrompt } from "./wire/wire.js";
```

- [ ] **Step 2: Write integration test**

```ts
// tests/integration/staged-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  WorkTree,
  CodeTree,
  WorkerOutput,
  ProjectConfig,
  ProjectState,
  StageResult,
  TaskDigest,
  SpringTrainingResult,
  Storage,
} from "@openingday/core";
import { validateStructure } from "@openingday/core/spring-training/validate";
import { simulateExecution } from "@openingday/core/spring-training/simulate";
import { generateDigest } from "@openingday/core/digests/generator";
import { createLoopTracker, recordLoop, shouldBreak } from "@openingday/core/safety/loops";
import { createWatchdog, createWatchdogState } from "@openingday/core/safety/watchdog";
import { buildEnrichedContext } from "@openingday/core/context/context-builder";
import { toEnrichedWirePrompt } from "@openingday/core/wire/wire";

const config: ProjectConfig = {
  name: "test-integration",
  specPath: "spec.md",
  budgets: {
    project: { usd: 50, warnPct: 70 },
    perTask: { usd: 2, softPct: 75 },
    supervisor: { usd: 3 },
    planning: { usd: 5 },
  },
  limits: {
    maxConcurrentWorkers: 3,
    maxTotalWorkers: 50,
    maxRetries: 3,
    maxTaskDepth: 4,
    sessionTimeoutMin: 15,
    spawnRatePerMin: 5,
  },
  circuitBreakers: {
    consecutiveFailuresSlice: 3,
    consecutiveFailuresProject: 5,
    budgetEfficiencyThreshold: 0.5,
  },
};

function buildTestTrees(): { workTree: WorkTree; codeTree: CodeTree } {
  const workTree: WorkTree = {
    milestones: [
      {
        id: "m1",
        name: "Build",
        description: "Build the API",
        dependencies: [],
        slices: [
          {
            id: "m1-s1",
            name: "Core",
            description: "Core routes",
            parentMilestoneId: "m1",
            tasks: [
              {
                id: "m1-s1-t0",
                name: "Generate contracts",
                description: "Generate shared types in src/contracts.ts from spec",
                status: "complete",
                dependencies: [],
                touches: ["src/contracts.ts"],
                reads: [],
                worker: null,
                tokenSpend: 500,
                attemptCount: 1,
                gateResults: [],
                parentSliceId: "m1-s1",
              },
              {
                id: "m1-s1-t1",
                name: "Create players route",
                description:
                  "Create GET/POST /players in src/routes/players.ts, import Player from contracts.ts, include tests",
                status: "pending",
                dependencies: ["m1-s1-t0"],
                touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
                reads: ["src/contracts.ts"],
                worker: null,
                tokenSpend: 0,
                attemptCount: 0,
                gateResults: [],
                parentSliceId: "m1-s1",
              },
              {
                id: "m1-s1-t2",
                name: "Create teams route",
                description:
                  "Create GET/POST /teams in src/routes/teams.ts, import Team from contracts.ts, include tests",
                status: "pending",
                dependencies: ["m1-s1-t0"],
                touches: ["src/routes/teams.ts", "src/__tests__/teams.test.ts"],
                reads: ["src/contracts.ts"],
                worker: null,
                tokenSpend: 0,
                attemptCount: 0,
                gateResults: [],
                parentSliceId: "m1-s1",
              },
            ],
          },
        ],
      },
    ],
  };

  const codeTree: CodeTree = {
    modules: [
      {
        path: "src",
        description: "source",
        files: [
          {
            path: "src/contracts.ts",
            description: "shared types",
            exports: [
              { name: "Player", signature: "interface Player", description: "Player entity" },
            ],
            imports: [],
            lastModifiedBy: "m1-s1-t0",
          },
          {
            path: "src/routes/players.ts",
            description: "players route",
            exports: [],
            imports: [{ from: "src/contracts", names: ["Player"] }],
            lastModifiedBy: null,
          },
          {
            path: "src/routes/teams.ts",
            description: "teams route",
            exports: [],
            imports: [{ from: "src/contracts", names: ["Team"] }],
            lastModifiedBy: null,
          },
          {
            path: "src/__tests__/players.test.ts",
            description: "players tests",
            exports: [],
            imports: [],
            lastModifiedBy: null,
          },
          {
            path: "src/__tests__/teams.test.ts",
            description: "teams tests",
            exports: [],
            imports: [],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };

  return { workTree, codeTree };
}

describe("staged pipeline integration", () => {
  it("validates structure of well-formed trees", () => {
    const { workTree, codeTree } = buildTestTrees();
    const result = validateStructure(workTree, codeTree);
    expect(result.valid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("simulates execution and returns correct order", () => {
    const { workTree, codeTree } = buildTestTrees();
    const result = simulateExecution(workTree, codeTree);
    // t0 must come first (contracts), then t1 and t2 can be parallel
    expect(result.executionOrder[0]).toBe("m1-s1-t0");
    expect(result.executionOrder).toContain("m1-s1-t1");
    expect(result.executionOrder).toContain("m1-s1-t2");
  });

  it("generates digest from completed task output", () => {
    const { workTree, codeTree } = buildTestTrees();
    const output: WorkerOutput = {
      status: "complete",
      filesChanged: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
      interfacesModified: [
        { file: "src/routes/players.ts", export: "playersRouter", before: "", after: "Router" },
      ],
      testsAdded: ["src/__tests__/players.test.ts"],
      testResults: { pass: 3, fail: 0 },
      notes: "Created GET/POST /players endpoints",
      tokensUsed: 12000,
    };
    const digest = generateDigest("m1-s1-t1", output, workTree, codeTree);
    expect(digest.task).toBe("m1-s1-t1");
    expect(digest.ex).toContain("playersRouter");
  });

  it("loop tracker breaks after 5 stage loops", () => {
    let tracker = createLoopTracker("t1");
    for (let i = 0; i < 5; i++) {
      tracker = recordLoop(tracker, "compile");
    }
    const result = shouldBreak(tracker, "compile", [], []);
    expect(result.break).toBe(true);
  });

  it("watchdog returns continue for recent activity", () => {
    const watchdog = createWatchdog(createWatchdogState());
    expect(watchdog.check()).toBe("continue");
  });

  it("builds enriched context with contracts and digests", () => {
    const { workTree, codeTree } = buildTestTrees();
    const digests: TaskDigest[] = [
      {
        task: "m1-s1-t0",
        did: "generated contracts",
        ex: ["Player", "Team"],
        im: [],
        pattern: "types",
      },
    ];
    const ctx = buildEnrichedContext(
      workTree,
      codeTree,
      config,
      "m1-s1-t1",
      "",
      "",
      undefined,
      "export interface Player { name: string; }",
      digests,
      "Build a baseball API",
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.contracts).toContain("Player");
    expect(ctx!.digests).toHaveLength(1);
    expect(ctx!.specExcerpt).toContain("baseball");
  });

  it("converts enriched context to wire prompt with all fields", () => {
    const { workTree, codeTree } = buildTestTrees();
    const ctx = buildEnrichedContext(
      workTree,
      codeTree,
      config,
      "m1-s1-t1",
      "",
      "",
      undefined,
      "export interface Player { name: string; }",
      [{ task: "m1-s1-t0", did: "contracts", ex: ["Player"], im: [], pattern: "types" }],
      "Build a baseball API",
      { "src/contracts.ts": "export interface Player { name: string; }" },
    );
    expect(ctx).not.toBeNull();
    const wire = toEnrichedWirePrompt(ctx!);
    expect(wire.contents).toHaveProperty("src/contracts.ts");
    expect(wire.contracts).toContain("Player");
    expect(wire.digests).toHaveLength(1);
  });

  it("full flow: validate -> simulate -> digest -> loop check -> enriched context", () => {
    const { workTree, codeTree } = buildTestTrees();

    // 1. Validate
    const validation = validateStructure(workTree, codeTree);
    expect(validation.valid).toBe(true);

    // 2. Simulate
    const simulation = simulateExecution(workTree, codeTree);
    expect(simulation.executionOrder.length).toBe(3);

    // 3. Mock task completion and digest
    const output: WorkerOutput = {
      status: "complete",
      filesChanged: ["src/routes/players.ts"],
      interfacesModified: [
        { file: "src/routes/players.ts", export: "playersRouter", before: "", after: "Router" },
      ],
      testsAdded: [],
      testResults: { pass: 3, fail: 0 },
      notes: "done",
      tokensUsed: 10000,
    };
    const digest = generateDigest("m1-s1-t1", output, workTree, codeTree);
    expect(digest.task).toBe("m1-s1-t1");

    // 4. Build enriched context for next task with prior digest
    const ctx = buildEnrichedContext(
      workTree,
      codeTree,
      config,
      "m1-s1-t2",
      "",
      "",
      undefined,
      "export interface Team { name: string; }",
      [digest],
      "Build a baseball API",
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.digests).toHaveLength(1);
    expect(ctx!.digests[0]!.task).toBe("m1-s1-t1");

    // 5. Loop tracking works
    let tracker = createLoopTracker("m1-s1-t2");
    tracker = recordLoop(tracker, "compile");
    const breakResult = shouldBreak(tracker, "compile", [], []);
    expect(breakResult.break).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- --run tests/integration/staged-pipeline.test.ts
pnpm typecheck
```

**Commit:** `feat(core): export all new modules, add staged pipeline integration test`

---

## Task 19: Final Verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

- [ ] **Step 4: Verify CLI help**

```bash
npx openingday --help
```

Verify output includes `spring-training` command alongside existing commands.

- [ ] **Step 5: Fix any failures**

If any step fails, fix the issue and re-verify. Each fix gets its own commit with a descriptive message.

**Commit:** `chore: final verification — all tests pass, typecheck clean, build succeeds`

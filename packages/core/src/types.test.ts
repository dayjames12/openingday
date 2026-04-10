import { describe, it, expect } from "vitest";
import type {
  ProjectConfig,
  WorkTask,
  CodeFile,
  WorkerOutput,
  ProjectState,
  StageFeedback,
  StageResult,
  TaskDigest,
  SpringTrainingResult,
  EnrichedContextPackage,
  WatchdogState,
  LoopTracker,
} from "./types.js";

describe("types", () => {
  it("creates a valid WorkTask", () => {
    const task: WorkTask = {
      id: "task-1",
      name: "JWT middleware",
      description: "Implement JWT auth middleware",
      status: "pending",
      dependencies: [],
      touches: ["core/auth/middleware.ts"],
      reads: ["core/auth/types.ts"],
      worker: null,
      tokenSpend: 0,
      attemptCount: 0,
      gateResults: [],
      parentSliceId: "slice-1",
    };
    expect(task.status).toBe("pending");
    expect(task.touches).toContain("core/auth/middleware.ts");
  });

  it("creates a valid CodeFile", () => {
    const file: CodeFile = {
      path: "core/auth/middleware.ts",
      description: "JWT authentication middleware",
      exports: [
        {
          name: "authMiddleware",
          signature: "(opts: AuthOpts) => Middleware",
          description: "Creates JWT auth middleware",
        },
      ],
      imports: [{ from: "core/auth/types", names: ["AuthOpts", "Middleware"] }],
      lastModifiedBy: null,
    };
    expect(file.exports).toHaveLength(1);
    expect(file.exports[0]!.name).toBe("authMiddleware");
  });

  it("creates a valid WorkerOutput", () => {
    const output: WorkerOutput = {
      status: "complete",
      filesChanged: ["core/auth/middleware.ts"],
      interfacesModified: [],
      testsAdded: ["core/auth/middleware.test.ts"],
      testResults: { pass: 5, fail: 0 },
      notes: "",
      tokensUsed: 28000,
    };
    expect(output.status).toBe("complete");
  });

  it("creates a valid ProjectConfig", () => {
    const config: ProjectConfig = {
      name: "test-project",
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
    expect(config.budgets.project.usd).toBe(50);
  });

  it("creates valid ProjectState", () => {
    const state: ProjectState = {
      status: "running",
      totalTokenSpend: 12400,
      totalWorkersSpawned: 8,
      startedAt: "2026-04-07T10:00:00Z",
      pausedAt: null,
    };
    expect(state.status).toBe("running");
  });

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
});

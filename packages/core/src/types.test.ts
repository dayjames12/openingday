import { describe, it, expect } from "vitest";
import type {
  ProjectConfig,
  WorkTask,
  CodeFile,
  WorkerOutput,
  ProjectState,
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
      imports: [
        { from: "core/auth/types", names: ["AuthOpts", "Middleware"] },
      ],
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
});

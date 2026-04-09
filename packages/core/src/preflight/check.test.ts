import { describe, it, expect } from "vitest";
import { preflightCheck } from "./check.js";
import type { WorkTree, CodeTree, ProjectConfig } from "../types.js";

function makeConfig(): ProjectConfig {
  return {
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
}

function makeCodeTree(): CodeTree {
  return {
    modules: [
      {
        path: "src",
        description: "Source",
        files: [
          {
            path: "src/feature.ts",
            description: "Feature",
            exports: [{ name: "doStuff", signature: "() => void", description: "" }],
            imports: [],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };
}

function makeWorkTree(overrides?: {
  description?: string;
  touches?: string[];
  dependencies?: string[];
  attemptCount?: number;
  extraTasks?: Array<{
    id: string;
    status: string;
    touches: string[];
    dependencies: string[];
  }>;
}): WorkTree {
  const tasks: WorkTree["milestones"][0]["slices"][0]["tasks"] = [
    {
      id: "t1",
      name: "Task 1",
      description: overrides?.description ?? "Add the doStuff function in src/feature.ts",
      status: "pending",
      dependencies: overrides?.dependencies ?? [],
      touches: overrides?.touches ?? ["src/feature.ts"],
      reads: [],
      worker: null,
      tokenSpend: 0,
      attemptCount: overrides?.attemptCount ?? 0,
      gateResults: [],
      parentSliceId: "s1",
    },
  ];

  if (overrides?.extraTasks) {
    for (const et of overrides.extraTasks) {
      tasks.push({
        id: et.id,
        name: et.id,
        description: "Extra task for testing",
        status: et.status as "pending" | "in_progress" | "complete" | "failed" | "paused",
        dependencies: et.dependencies,
        touches: et.touches,
        reads: [],
        worker: null,
        tokenSpend: 0,
        attemptCount: 0,
        gateResults: [],
        parentSliceId: "s1",
      });
    }
  }

  return {
    milestones: [
      {
        id: "m1",
        name: "M1",
        description: "",
        dependencies: [],
        slices: [
          {
            id: "s1",
            name: "S1",
            description: "",
            parentMilestoneId: "m1",
            tasks,
          },
        ],
      },
    ],
  };
}

describe("preflightCheck", () => {
  it("passes for a well-formed task", () => {
    const result = preflightCheck(
      makeWorkTree(),
      makeCodeTree(),
      null,
      makeConfig(),
      "t1",
    );
    expect(result.canProceed).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks task not found in work tree", () => {
    const result = preflightCheck(
      makeWorkTree(),
      makeCodeTree(),
      null,
      makeConfig(),
      "nonexistent",
    );
    expect(result.canProceed).toBe(false);
    expect(result.blockers[0]).toContain("not found");
  });

  it("blocks task with too-short description", () => {
    const result = preflightCheck(
      makeWorkTree({ description: "Short" }),
      makeCodeTree(),
      null,
      makeConfig(),
      "t1",
    );
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes("too short"))).toBe(true);
  });

  it("warns when touch file not in code tree", () => {
    const result = preflightCheck(
      makeWorkTree({ touches: ["src/missing.ts"] }),
      makeCodeTree(),
      null,
      makeConfig(),
      "t1",
    );
    expect(result.warnings.some((w) => w.includes("not found"))).toBe(true);
  });

  it("blocks task that exhausted retries", () => {
    const result = preflightCheck(
      makeWorkTree({ attemptCount: 3 }),
      makeCodeTree(),
      null,
      makeConfig(),
      "t1",
    );
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes("retry"))).toBe(true);
  });

  it("detects circular dependencies", () => {
    // t1 depends on t2, t2 depends on t1
    const result = preflightCheck(
      makeWorkTree({
        dependencies: ["t2"],
        extraTasks: [{ id: "t2", status: "pending", touches: ["src/feature.ts"], dependencies: ["t1"] }],
      }),
      makeCodeTree(),
      null,
      makeConfig(),
      "t1",
    );
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes("Circular"))).toBe(true);
  });

  it("warns on file conflicts with in-progress tasks", () => {
    const result = preflightCheck(
      makeWorkTree({
        extraTasks: [{
          id: "t2",
          status: "in_progress",
          touches: ["src/feature.ts"],
          dependencies: [],
        }],
      }),
      makeCodeTree(),
      null,
      makeConfig(),
      "t1",
    );
    expect(result.warnings.some((w) => w.includes("conflict"))).toBe(true);
  });

  it("blocks missing touch files in brownfield mode (repoMap provided)", () => {
    const repoMap = {
      v: 1,
      scannedAt: new Date().toISOString(),
      depth: "standard" as const,
      env: {
        pm: "pnpm" as const,
        test: "vitest" as const,
        lint: "eslint" as const,
        ts: true,
        monorepo: false,
        workspaces: [],
        infra: "none" as const,
      },
      deps: [],
      modules: [
        {
          p: "src",
          d: "Source",
          fc: 1,
          k: [],
          files: [{ p: "src/existing.ts", ex: [], im: [], loc: 10 }],
        },
      ],
    };

    const result = preflightCheck(
      makeWorkTree({ touches: ["src/nonexistent.ts"] }),
      makeCodeTree(),
      repoMap,
      makeConfig(),
      "t1",
    );
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes("brownfield"))).toBe(true);
  });

  it("accepts touch files found in repo map", () => {
    const repoMap = {
      v: 1,
      scannedAt: new Date().toISOString(),
      depth: "standard" as const,
      env: {
        pm: "pnpm" as const,
        test: "vitest" as const,
        lint: "eslint" as const,
        ts: true,
        monorepo: false,
        workspaces: [],
        infra: "none" as const,
      },
      deps: [],
      modules: [
        {
          p: "src",
          d: "Source",
          fc: 1,
          k: [],
          files: [{ p: "src/new-file.ts", ex: [], im: [], loc: 10 }],
        },
      ],
    };

    const result = preflightCheck(
      makeWorkTree({ touches: ["src/new-file.ts"] }),
      makeCodeTree(),
      repoMap,
      makeConfig(),
      "t1",
    );
    // Should not warn about missing file since it's in repo map
    expect(result.warnings.filter((w) => w.includes("not found"))).toHaveLength(0);
  });
});

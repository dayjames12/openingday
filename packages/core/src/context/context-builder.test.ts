import { describe, it, expect } from "vitest";
import { buildContext, buildEnrichedContext } from "./context-builder.js";
import { createWorkTree, addMilestone, addSlice, addTask } from "../trees/work-tree.js";
import { createCodeTree, addModule, addFile } from "../trees/code-tree.js";
import { defaultConfig } from "../config/defaults.js";
import type { WorkTree, CodeTree, ProjectConfig, TaskDigest } from "../types.js";

function buildFixture(): { workTree: WorkTree; codeTree: CodeTree; config: ProjectConfig } {
  let codeTree = createCodeTree();
  codeTree = addModule(codeTree, { path: "src/auth", description: "Auth" });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/types.ts",
    description: "Auth types",
    exports: [{ name: "AuthOpts", signature: "interface AuthOpts", description: "Opts" }],
    imports: [],
  });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/middleware.ts",
    description: "JWT middleware",
    exports: [{ name: "authMiddleware", signature: "() => MW", description: "MW" }],
    imports: [{ from: "src/auth/types.ts", names: ["AuthOpts"] }],
  });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/routes.ts",
    description: "Auth routes",
    exports: [{ name: "authRoutes", signature: "() => Router", description: "Routes" }],
    imports: [{ from: "src/auth/middleware.ts", names: ["authMiddleware"] }],
  });

  let workTree = createWorkTree();
  workTree = addMilestone(workTree, { id: "m1", name: "Auth", description: "", dependencies: [] });
  workTree = addSlice(workTree, "m1", { id: "s1", name: "JWT", description: "" });
  workTree = addTask(workTree, "s1", {
    id: "t1",
    name: "JWT middleware",
    description: "Implement JWT auth middleware",
    dependencies: [],
    touches: ["src/auth/middleware.ts"],
    reads: ["src/auth/types.ts"],
  });

  const config = defaultConfig("test-project", "spec.md");

  return { workTree, codeTree, config };
}

describe("context-builder", () => {
  it("builds a context package for a valid task", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "memory text", "rules text");

    expect(ctx).not.toBeNull();
    expect(ctx!.task.name).toBe("JWT middleware");
    expect(ctx!.task.description).toBe("Implement JWT auth middleware");
    expect(ctx!.memory).toBe("memory text");
    expect(ctx!.rules).toBe("rules text");
  });

  it("returns null for nonexistent task", () => {
    const { workTree, codeTree, config } = buildFixture();
    expect(buildContext(workTree, codeTree, config, "nope", "", "")).toBeNull();
  });

  it("includes touched files as interfaces", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    expect(ctx.interfaces).toHaveLength(1);
    expect(ctx.interfaces[0]!.path).toBe("src/auth/middleware.ts");
  });

  it("includes dependencies and reads as above files", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    // types.ts is both a dependency of middleware.ts and an explicit read
    expect(ctx.above.map((f) => f.path)).toContain("src/auth/types.ts");
  });

  it("includes dependents as below files", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    // routes.ts imports from middleware.ts
    expect(ctx.below.map((f) => f.path)).toContain("src/auth/routes.ts");
  });

  it("does not duplicate files across interfaces, above, and below", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    const allPaths = [
      ...ctx.interfaces.map((f) => f.path),
      ...ctx.above.map((f) => f.path),
      ...ctx.below.map((f) => f.path),
    ];
    const unique = new Set(allPaths);
    expect(allPaths.length).toBe(unique.size);
  });

  it("computes budget from config", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    // perTask: $5, softPct: 75%, so softLimit = 5 * 0.75 * 1000 = 3750
    expect(ctx.budget.softLimit).toBe(3750);
    // hardLimit = 5 * 1000 = 5000
    expect(ctx.budget.hardLimit).toBe(5000);
  });

  it("builds acceptance criteria from task", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    expect(ctx.task.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(ctx.task.acceptanceCriteria[0]).toContain("JWT middleware");
  });
});

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

import { describe, it, expect } from "vitest";
import type {
  WorkTree,
  CodeTree,
  WorkerOutput,
  ProjectConfig,
  TaskDigest,
} from "../../packages/core/src/types.js";
import { validateStructure } from "../../packages/core/src/spring-training/validate.js";
import { simulateExecution } from "../../packages/core/src/spring-training/simulate.js";
import { generateDigest } from "../../packages/core/src/digests/generator.js";
import {
  createLoopTracker,
  recordLoop,
  shouldBreak,
} from "../../packages/core/src/safety/loops.js";
import { createWatchdog, createWatchdogState } from "../../packages/core/src/safety/watchdog.js";
import { buildEnrichedContext } from "../../packages/core/src/context/context-builder.js";
import { toEnrichedWirePrompt } from "../../packages/core/src/wire/wire.js";

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

/**
 * Multi-cycle orchestration integration test.
 *
 * Exercises the Orchestrator class through multiple runOneCycle() calls
 * with a mock spawner, verifying the full lifecycle:
 *
 *   Cycle 1: dispatch t1 (t2 blocked by dependency) -> success
 *   Cycle 2: dispatch t2 (now unblocked) -> success
 *   Cycle 3: detect project completion
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DiskStorage } from "../packages/core/src/storage/disk.js";
import { Orchestrator } from "../packages/core/src/orchestrator.js";
import type { SpawnFn } from "../packages/core/src/orchestrator.js";
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
} from "../packages/core/src/types.js";
import type { SpawnResult } from "../packages/core/src/workers/spawner.js";
import { getTask, getAllTasks } from "../packages/core/src/trees/work-tree.js";

// === Fixtures ===

function makeConfig(): ProjectConfig {
  return {
    name: "multi-cycle-test",
    specPath: "spec.md",
    budgets: {
      project: { usd: 50, warnPct: 70 },
      perTask: { usd: 5, softPct: 75 },
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

function makeRunningState(): ProjectState {
  return {
    status: "running",
    totalTokenSpend: 0,
    totalWorkersSpawned: 0,
    startedAt: new Date().toISOString(),
    pausedAt: null,
  };
}

function makeWorkTree(): WorkTree {
  return {
    milestones: [
      {
        id: "ms-1",
        name: "Backend Services",
        description: "Core backend services",
        dependencies: [],
        slices: [
          {
            id: "sl-1",
            name: "Service Layer",
            description: "Data and user services",
            parentMilestoneId: "ms-1",
            tasks: [
              {
                id: "t1",
                name: "Database layer",
                description: "Implement database connection pool and query helper",
                status: "pending",
                dependencies: [],
                touches: ["src/services/db.ts"],
                reads: [],
                worker: null,
                tokenSpend: 0,
                attemptCount: 0,
                gateResults: [],
                parentSliceId: "sl-1",
              },
              {
                id: "t2",
                name: "User service",
                description: "Implement user CRUD using the database layer",
                status: "pending",
                dependencies: ["t1"],
                touches: ["src/services/user-service.ts"],
                reads: ["src/services/db.ts"],
                worker: null,
                tokenSpend: 0,
                attemptCount: 0,
                gateResults: [],
                parentSliceId: "sl-1",
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeCodeTree(): CodeTree {
  return {
    modules: [
      {
        path: "src/services",
        description: "Application services",
        files: [
          {
            path: "src/services/db.ts",
            description: "Database connection layer",
            exports: [
              { name: "createPool", signature: "() => Pool", description: "Create DB pool" },
              {
                name: "query",
                signature: "(sql: string) => Promise<Row[]>",
                description: "Run query",
              },
            ],
            imports: [],
            lastModifiedBy: null,
          },
          {
            path: "src/services/user-service.ts",
            description: "User CRUD service",
            exports: [
              {
                name: "UserService",
                signature: "class UserService",
                description: "User operations",
              },
            ],
            imports: [{ from: "src/services/db.ts", names: ["query"] }],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };
}

describe("multi-cycle orchestration with mock spawner", () => {
  let tmpDir: string;
  let storage: DiskStorage;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("dispatches t1, then t2, then detects completion across 3 cycles", async () => {
    // ================================================================
    // SETUP: temp storage with config, state, work tree, code tree
    // ================================================================
    tmpDir = await mkdtemp(join(tmpdir(), "od-multi-cycle-"));
    storage = new DiskStorage(tmpDir);
    await storage.initialize();

    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeRunningState());
    await storage.writeWorkTree(makeWorkTree());
    await storage.writeCodeTree(makeCodeTree());

    // Track which tasks the spawner was called with
    const spawnedTaskIds: string[] = [];

    // Mock spawner: returns success for any task
    const mockSpawner: SpawnFn = async (opts) => {
      spawnedTaskIds.push(opts.taskId);

      const task = getTask(makeWorkTree(), opts.taskId);
      const output: WorkerOutput = {
        status: "complete",
        filesChanged: task ? task.touches : [],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 3, fail: 0 },
        notes: `done: ${opts.taskId}`,
        tokensUsed: 15000,
      };
      return {
        output,
        costUsd: 0.1,
        sessionId: `mock-${opts.taskId}`,
        needsInspection: false,
      } satisfies SpawnResult;
    };

    const orchestrator = new Orchestrator(storage, mockSpawner);

    // ================================================================
    // CYCLE 1: Should dispatch t1 (t2 blocked by dependency on t1)
    // ================================================================
    const cycle1 = await orchestrator.runOneCycle();

    expect(cycle1.dispatched).toBe(1);
    expect(cycle1.completed).toBe(1);
    expect(cycle1.failed).toBe(0);
    expect(cycle1.isComplete).toBe(false);
    expect(cycle1.isPaused).toBe(false);

    // Verify t1 is "complete" in storage
    const treeAfterCycle1 = await storage.readWorkTree();
    expect(getTask(treeAfterCycle1, "t1")!.status).toBe("complete");
    expect(getTask(treeAfterCycle1, "t2")!.status).toBe("pending");

    // Verify spawner was called with t1
    expect(spawnedTaskIds).toEqual(["t1"]);

    // ================================================================
    // CYCLE 2: Should dispatch t2 (now unblocked since t1 is complete)
    // ================================================================
    const cycle2 = await orchestrator.runOneCycle();

    expect(cycle2.dispatched).toBe(1);
    expect(cycle2.completed).toBe(1);
    expect(cycle2.failed).toBe(0);
    expect(cycle2.isComplete).toBe(false);
    expect(cycle2.isPaused).toBe(false);

    // Verify t2 is now "complete" in storage
    const treeAfterCycle2 = await storage.readWorkTree();
    expect(getTask(treeAfterCycle2, "t1")!.status).toBe("complete");
    expect(getTask(treeAfterCycle2, "t2")!.status).toBe("complete");

    // Verify spawner was called with t2
    expect(spawnedTaskIds).toEqual(["t1", "t2"]);

    // ================================================================
    // CYCLE 3: Should detect completion (all tasks done, no active workers)
    // ================================================================
    const cycle3 = await orchestrator.runOneCycle();

    expect(cycle3.isComplete).toBe(true);
    expect(cycle3.dispatched).toBe(0);
    expect(cycle3.completed).toBe(0);
    expect(cycle3.failed).toBe(0);
    expect(cycle3.isPaused).toBe(false);

    // ================================================================
    // VERIFY: State persisted as "complete"
    // ================================================================
    const finalState = await storage.readProjectState();
    expect(finalState.status).toBe("complete");

    // ================================================================
    // VERIFY: All worker outputs stored
    // ================================================================
    const t1Output = await storage.readWorkerOutput("t1");
    expect(t1Output).not.toBeNull();
    expect(t1Output!.status).toBe("complete");
    expect(t1Output!.filesChanged).toEqual(["src/services/db.ts"]);
    expect(t1Output!.tokensUsed).toBe(15000);
    expect(t1Output!.notes).toBe("done: t1");

    const t2Output = await storage.readWorkerOutput("t2");
    expect(t2Output).not.toBeNull();
    expect(t2Output!.status).toBe("complete");
    expect(t2Output!.filesChanged).toEqual(["src/services/user-service.ts"]);
    expect(t2Output!.tokensUsed).toBe(15000);
    expect(t2Output!.notes).toBe("done: t2");

    // ================================================================
    // VERIFY: Gate results stored for both tasks
    // ================================================================
    const t1Gates = await storage.readGateResults("t1");
    expect(t1Gates.length).toBeGreaterThan(0);
    expect(t1Gates.every((g) => g.pass)).toBe(true);

    const t2Gates = await storage.readGateResults("t2");
    expect(t2Gates.length).toBeGreaterThan(0);
    expect(t2Gates.every((g) => g.pass)).toBe(true);

    // ================================================================
    // VERIFY: Memory untouched (no failures means no memory entries)
    // ================================================================
    const memory = await storage.readMemory();
    expect(memory).toBe("");

    // ================================================================
    // VERIFY: Budget tracked
    // ================================================================
    expect(finalState.totalTokenSpend).toBe(30000); // 15000 * 2 tasks
    expect(finalState.totalWorkersSpawned).toBe(2);

    // ================================================================
    // VERIFY: Final work tree is consistent
    // ================================================================
    const finalTree = await storage.readWorkTree();
    const allTasks = getAllTasks(finalTree);
    expect(allTasks).toHaveLength(2);
    expect(allTasks.every((t) => t.status === "complete")).toBe(true);
    expect(allTasks.find((t) => t.id === "t1")!.tokenSpend).toBe(15000);
    expect(allTasks.find((t) => t.id === "t2")!.tokenSpend).toBe(15000);
  });
});

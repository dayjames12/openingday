import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiskStorage } from "./storage/disk.js";
import { Orchestrator } from "./orchestrator.js";
import type { SpawnFn } from "./orchestrator.js";
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
} from "./types.js";
import type { SpawnResult } from "./workers/spawner.js";

function makeConfig(): ProjectConfig {
  return {
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

function makeWorkTreeWithOneTask(): WorkTree {
  return {
    milestones: [
      {
        id: "ms-1",
        name: "Milestone 1",
        description: "First milestone",
        dependencies: [],
        slices: [
          {
            id: "slice-1",
            name: "Slice 1",
            description: "First slice",
            parentMilestoneId: "ms-1",
            tasks: [
              {
                id: "t1",
                name: "Task 1",
                description: "Implement feature handler in src/feature.ts — exports doStuff()",
                status: "pending",
                dependencies: [],
                touches: ["src/feature.ts"],
                reads: [],
                worker: null,
                tokenSpend: 0,
                attemptCount: 0,
                gateResults: [],
                parentSliceId: "slice-1",
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeEmptyWorkTree(): WorkTree {
  return { milestones: [] };
}

function makeCodeTree(): CodeTree {
  return {
    modules: [
      {
        path: "src",
        description: "Source module",
        files: [
          {
            path: "src/feature.ts",
            description: "Feature file",
            exports: [],
            imports: [],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };
}

describe("Orchestrator", () => {
  let tmpDir: string;
  let storage: DiskStorage;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestrator-test-"));
    storage = new DiskStorage(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs one dispatch cycle with mock spawner", async () => {
    // Set up storage with config, state, work tree, code tree
    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeRunningState());
    await storage.writeWorkTree(makeWorkTreeWithOneTask());
    await storage.writeCodeTree(makeCodeTree());

    // Mock spawner that returns success
    const mockSpawn: SpawnFn = async () => {
      const output: WorkerOutput = {
        status: "complete",
        filesChanged: ["src/feature.ts"],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 3, fail: 0 },
        notes: "Implemented feature",
        tokensUsed: 15000,
      };
      return {
        output,
        costUsd: 0.15,
        sessionId: "mock-session-1",
        needsInspection: false,
      } satisfies SpawnResult;
    };

    const orchestrator = new Orchestrator(storage, mockSpawn);
    const result = await orchestrator.runOneCycle();

    expect(result.dispatched).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.isPaused).toBe(false);

    // Verify task t1 is now "complete" in persisted work tree
    const workTree = await storage.readWorkTree();
    const task = workTree.milestones[0]!.slices[0]!.tasks[0]!;
    expect(task.id).toBe("t1");
    expect(task.status).toBe("complete");
  });

  it("retries failed task with attemptCount below maxRetries", async () => {
    const workTree = makeWorkTreeWithOneTask();
    // Pre-set task as failed with 1 attempt (under maxRetries=3)
    workTree.milestones[0]!.slices[0]!.tasks[0]!.status = "failed";
    workTree.milestones[0]!.slices[0]!.tasks[0]!.attemptCount = 1;

    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeRunningState());
    await storage.writeWorkTree(workTree);
    await storage.writeCodeTree(makeCodeTree());

    const mockSpawn: SpawnFn = async () => {
      const output: WorkerOutput = {
        status: "complete",
        filesChanged: ["src/feature.ts"],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 1, fail: 0 },
        notes: "Fixed on retry",
        tokensUsed: 8000,
      };
      return { output, costUsd: 0.08, sessionId: "retry-session", needsInspection: false };
    };

    const orchestrator = new Orchestrator(storage, mockSpawn);
    const result = await orchestrator.runOneCycle();

    expect(result.dispatched).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);

    const persisted = await storage.readWorkTree();
    const task = persisted.milestones[0]!.slices[0]!.tasks[0]!;
    expect(task.status).toBe("complete");
    expect(task.attemptCount).toBe(2); // was 1, incremented by applyWorkerResult
  });

  it("does not retry failed task at maxRetries limit", async () => {
    const workTree = makeWorkTreeWithOneTask();
    // Pre-set task as failed with 3 attempts (at maxRetries=3)
    workTree.milestones[0]!.slices[0]!.tasks[0]!.status = "failed";
    workTree.milestones[0]!.slices[0]!.tasks[0]!.attemptCount = 3;

    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeRunningState());
    await storage.writeWorkTree(workTree);
    await storage.writeCodeTree(makeCodeTree());

    const mockSpawn: SpawnFn = async () => {
      throw new Error("Spawner should not have been called");
    };

    const orchestrator = new Orchestrator(storage, mockSpawn);
    const result = await orchestrator.runOneCycle();

    // Task stays failed, project completes (all tasks terminal)
    expect(result.dispatched).toBe(0);
    expect(result.isComplete).toBe(true);

    const persisted = await storage.readWorkTree();
    const task = persisted.milestones[0]!.slices[0]!.tasks[0]!;
    expect(task.status).toBe("failed");
    expect(task.attemptCount).toBe(3);
  });

  it("retried task that fails again increments attemptCount", async () => {
    const workTree = makeWorkTreeWithOneTask();
    workTree.milestones[0]!.slices[0]!.tasks[0]!.status = "failed";
    workTree.milestones[0]!.slices[0]!.tasks[0]!.attemptCount = 1;

    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeRunningState());
    await storage.writeWorkTree(workTree);
    await storage.writeCodeTree(makeCodeTree());

    // Spawn throws to simulate another failure
    const mockSpawn: SpawnFn = async () => {
      throw new Error("Worker crashed again");
    };

    const orchestrator = new Orchestrator(storage, mockSpawn);
    const result = await orchestrator.runOneCycle();

    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.completed).toBe(0);

    const persisted = await storage.readWorkTree();
    const task = persisted.milestones[0]!.slices[0]!.tasks[0]!;
    expect(task.status).toBe("failed");
    expect(task.attemptCount).toBe(2); // was 1, incremented on failure
  });

  it("detects project completion", async () => {
    // Set up storage with empty work tree (no tasks)
    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeRunningState());
    await storage.writeWorkTree(makeEmptyWorkTree());
    await storage.writeCodeTree(makeCodeTree());

    // Spawner should never be called
    const mockSpawn: SpawnFn = async () => {
      throw new Error("Spawner should not have been called");
    };

    const orchestrator = new Orchestrator(storage, mockSpawn);
    const result = await orchestrator.runOneCycle();

    expect(result.isComplete).toBe(true);
    expect(result.dispatched).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
  });
});

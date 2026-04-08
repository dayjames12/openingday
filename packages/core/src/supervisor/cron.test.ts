import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiskStorage } from "../storage/disk.js";
import { runSupervisorCheck } from "./cron.js";
import { createWorkerPool } from "../workers/pool.js";
import type { ProjectConfig, ProjectState, WorkTree, CodeTree } from "../types.js";

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

function makeState(): ProjectState {
  return {
    status: "running",
    totalTokenSpend: 0,
    totalWorkersSpawned: 0,
    startedAt: new Date().toISOString(),
    pausedAt: null,
  };
}

function makeWorkTreeWithDeadTask(): WorkTree {
  return {
    milestones: [
      {
        id: "ms-1",
        name: "Milestone 1",
        description: "",
        dependencies: [],
        slices: [
          {
            id: "slice-1",
            name: "Slice 1",
            description: "",
            parentMilestoneId: "ms-1",
            tasks: [
              {
                id: "t1",
                name: "Task 1",
                description: "Dead task",
                status: "in_progress",
                dependencies: [],
                touches: ["a.ts"],
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

function makeCodeTree(): CodeTree {
  return { modules: [] };
}

describe("supervisor cron", () => {
  let tmpDir: string;
  let storage: DiskStorage;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "supervisor-cron-test-"));
    storage = new DiskStorage(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resets dead tasks to pending", async () => {
    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeState());
    await storage.writeWorkTree(makeWorkTreeWithDeadTask());
    await storage.writeCodeTree(makeCodeTree());

    // Empty pool — no active sessions, so t1 is "dead"
    const pool = createWorkerPool();
    const result = await runSupervisorCheck(storage, pool, makeConfig());

    expect(result.deadTasksReset).toBe(1);
    expect(result.stuckWorkersFound).toBe(0);

    // Verify the work tree was updated
    const workTree = await storage.readWorkTree();
    const task = workTree.milestones[0]!.slices[0]!.tasks[0]!;
    expect(task.status).toBe("pending");
  });

  it("writes a supervisor log entry", async () => {
    await storage.writeProjectConfig(makeConfig());
    await storage.writeProjectState(makeState());
    await storage.writeWorkTree({ milestones: [] });
    await storage.writeCodeTree(makeCodeTree());

    const pool = createWorkerPool();
    await runSupervisorCheck(storage, pool, makeConfig());

    const logs = await storage.readSupervisorLogs();
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]!);
    expect(parsed).toHaveProperty("deadTasksReset");
    expect(parsed).toHaveProperty("stuckWorkersFound");
  });
});

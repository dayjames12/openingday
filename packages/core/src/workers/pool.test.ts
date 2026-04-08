import { describe, it, expect } from "vitest";
import {
  createWorkerPool,
  getActiveSessions,
  getSessionByTaskId,
  getActiveCount,
  planSpawns,
  spawnWorker,
  completeWorker,
  applyWorkerResult,
  findTimedOutSessions,
} from "./pool.js";
import { createWorkTree, addMilestone, addSlice, addTask, updateTaskStatus, getTask } from "../trees/work-tree.js";
import { defaultConfig } from "../config/defaults.js";
import type { WorkerOutput, ProjectState } from "../types.js";

const mockState: ProjectState = {
  status: "running",
  totalTokenSpend: 0,
  totalWorkersSpawned: 0,
  startedAt: "2026-04-07T10:00:00Z",
  pausedAt: null,
};

function buildWorkTree() {
  let tree = createWorkTree();
  tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
  tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
  tree = addTask(tree, "s1", {
    id: "t1", name: "Task 1", description: "", dependencies: [], touches: ["a.ts"], reads: [],
  });
  tree = addTask(tree, "s1", {
    id: "t2", name: "Task 2", description: "", dependencies: [], touches: ["b.ts"], reads: [],
  });
  tree = addTask(tree, "s1", {
    id: "t3", name: "Task 3", description: "", dependencies: [], touches: ["c.ts"], reads: [],
  });
  tree = addTask(tree, "s1", {
    id: "t4", name: "Task 4", description: "", dependencies: [], touches: ["d.ts"], reads: [],
  });
  return tree;
}

describe("worker pool", () => {
  it("creates an empty pool", () => {
    const pool = createWorkerPool();
    expect(pool.sessions).toEqual([]);
    expect(pool.totalSpawned).toBe(0);
  });

  it("spawns a worker", () => {
    let pool = createWorkerPool();
    pool = spawnWorker(pool, "sess-1", "t1");

    expect(pool.sessions).toHaveLength(1);
    expect(pool.sessions[0]!.status).toBe("active");
    expect(pool.sessions[0]!.taskId).toBe("t1");
    expect(pool.totalSpawned).toBe(1);
  });

  it("spawns a worker with worktreePath and lastActivityAt defaults", () => {
    let pool = createWorkerPool();
    pool = spawnWorker(pool, "sess-1", "t1");

    const session = pool.sessions[0]!;
    expect(session.worktreePath).toBeNull();
    expect(session.lastActivityAt).toBe(session.startedAt);
  });

  it("spawns a worker with explicit worktreePath", () => {
    let pool = createWorkerPool();
    pool = spawnWorker(pool, "sess-1", "t1", "/tmp/worktree-t1");

    const session = pool.sessions[0]!;
    expect(session.worktreePath).toBe("/tmp/worktree-t1");
    expect(session.lastActivityAt).toBe(session.startedAt);
  });

  it("getActiveSessions returns only active sessions", () => {
    let pool = createWorkerPool();
    pool = spawnWorker(pool, "sess-1", "t1");
    pool = spawnWorker(pool, "sess-2", "t2");
    pool = completeWorker(pool, "sess-1", "completed");

    expect(getActiveSessions(pool)).toHaveLength(1);
    expect(getActiveSessions(pool)[0]!.id).toBe("sess-2");
  });

  it("getSessionByTaskId finds active session", () => {
    let pool = createWorkerPool();
    pool = spawnWorker(pool, "sess-1", "t1");

    expect(getSessionByTaskId(pool, "t1")).not.toBeNull();
    expect(getSessionByTaskId(pool, "t1")!.id).toBe("sess-1");
    expect(getSessionByTaskId(pool, "nope")).toBeNull();
  });

  it("getActiveCount returns number of active sessions", () => {
    let pool = createWorkerPool();
    expect(getActiveCount(pool)).toBe(0);

    pool = spawnWorker(pool, "sess-1", "t1");
    pool = spawnWorker(pool, "sess-2", "t2");
    expect(getActiveCount(pool)).toBe(2);

    pool = completeWorker(pool, "sess-1", "completed");
    expect(getActiveCount(pool)).toBe(1);
  });

  it("completeWorker marks session status", () => {
    let pool = createWorkerPool();
    pool = spawnWorker(pool, "sess-1", "t1");
    pool = completeWorker(pool, "sess-1", "failed");

    expect(pool.sessions[0]!.status).toBe("failed");
  });

  describe("planSpawns", () => {
    it("plans spawns for ready tasks up to concurrent limit", () => {
      const tree = buildWorkTree();
      const pool = createWorkerPool();
      const config = defaultConfig("test", "spec.md");

      const decision = planSpawns(tree, pool, config, mockState);
      expect(decision.canSpawn).toBe(true);
      // Default maxConcurrentWorkers is 3, 4 tasks ready, so spawn 3
      expect(decision.tasksToSpawn).toHaveLength(3);
    });

    it("reports no ready tasks", () => {
      const tree = createWorkTree();
      const pool = createWorkerPool();
      const config = defaultConfig("test", "spec.md");

      const decision = planSpawns(tree, pool, config, mockState);
      expect(decision.canSpawn).toBe(false);
      expect(decision.reason).toBe("No ready tasks");
    });

    it("respects concurrent slot limit", () => {
      const tree = buildWorkTree();
      let pool = createWorkerPool();
      pool = spawnWorker(pool, "s1", "t1");
      pool = spawnWorker(pool, "s2", "t2");
      const config = defaultConfig("test", "spec.md");

      // Mark t1, t2 as in_progress in tree
      let wt = updateTaskStatus(tree, "t1", "in_progress");
      wt = updateTaskStatus(wt, "t2", "in_progress");

      const decision = planSpawns(wt, pool, config, mockState);
      expect(decision.canSpawn).toBe(true);
      // 3 max - 2 active = 1 slot
      expect(decision.tasksToSpawn).toHaveLength(1);
    });

    it("blocks when all slots filled", () => {
      const tree = buildWorkTree();
      let pool = createWorkerPool();
      pool = spawnWorker(pool, "s1", "t1");
      pool = spawnWorker(pool, "s2", "t2");
      pool = spawnWorker(pool, "s3", "t3");
      const config = defaultConfig("test", "spec.md");

      const decision = planSpawns(tree, pool, config, mockState);
      expect(decision.canSpawn).toBe(false);
      expect(decision.reason).toBe("All concurrent slots filled");
    });

    it("blocks when max total workers reached", () => {
      const tree = buildWorkTree();
      const config = defaultConfig("test", "spec.md");
      // Create pool with totalSpawned at max
      const pool = { sessions: [], totalSpawned: config.limits.maxTotalWorkers };

      const decision = planSpawns(tree, pool, config, mockState);
      expect(decision.canSpawn).toBe(false);
      expect(decision.reason).toBe("Max total workers reached");
    });
  });

  describe("applyWorkerResult", () => {
    it("marks task complete on successful output", () => {
      const tree = buildWorkTree();
      const output: WorkerOutput = {
        status: "complete",
        filesChanged: ["a.ts"],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 3, fail: 0 },
        notes: "",
        tokensUsed: 5000,
      };

      const updated = applyWorkerResult(tree, "t1", output);
      const task = getTask(updated, "t1")!;
      expect(task.status).toBe("complete");
      expect(task.tokenSpend).toBe(5000);
    });

    it("marks task failed on failed output", () => {
      const tree = buildWorkTree();
      const output: WorkerOutput = {
        status: "failed",
        filesChanged: [],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 0, fail: 1 },
        notes: "Timed out",
        tokensUsed: 2000,
      };

      const updated = applyWorkerResult(tree, "t1", output);
      expect(getTask(updated, "t1")!.status).toBe("failed");
    });
  });

  describe("findTimedOutSessions", () => {
    it("finds sessions past the timeout", () => {
      let pool = createWorkerPool();
      const past = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      pool = {
        ...pool,
        sessions: [
          { id: "s1", taskId: "t1", startedAt: past, status: "active" as const, worktreePath: null, lastActivityAt: past },
          { id: "s2", taskId: "t2", startedAt: new Date().toISOString(), status: "active" as const, worktreePath: null, lastActivityAt: new Date().toISOString() },
        ],
        totalSpawned: 2,
      };

      const timedOut = findTimedOutSessions(pool, 15);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0]!.id).toBe("s1");
    });

    it("ignores completed sessions", () => {
      let pool = createWorkerPool();
      const past = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      pool = {
        ...pool,
        sessions: [
          { id: "s1", taskId: "t1", startedAt: past, status: "completed" as const, worktreePath: null, lastActivityAt: past },
        ],
        totalSpawned: 1,
      };

      expect(findTimedOutSessions(pool, 15)).toHaveLength(0);
    });
  });
});

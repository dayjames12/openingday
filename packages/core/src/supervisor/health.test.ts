import { describe, it, expect } from "vitest";
import { findStuckWorkers, findDeadTasks } from "./health.js";
import { createWorkerPool, spawnWorker } from "../workers/pool.js";
import type { WorkerPool } from "../workers/pool.js";
import {
  createWorkTree,
  addMilestone,
  addSlice,
  addTask,
  updateTaskStatus,
} from "../trees/work-tree.js";

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
  return tree;
}

describe("supervisor health", () => {
  describe("findStuckWorkers", () => {
    it("detects workers whose lastActivityAt exceeds threshold", () => {
      const oldActivity = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const pool: WorkerPool = {
        sessions: [
          {
            id: "s1",
            taskId: "t1",
            startedAt: oldActivity,
            status: "active",
            worktreePath: null,
            lastActivityAt: oldActivity,
          },
        ],
        totalSpawned: 1,
      };

      const stuck = findStuckWorkers(pool, 15);
      expect(stuck).toHaveLength(1);
      expect(stuck[0]!.id).toBe("s1");
    });

    it("does not flag recently active workers", () => {
      const recentActivity = new Date().toISOString();
      const pool: WorkerPool = {
        sessions: [
          {
            id: "s1",
            taskId: "t1",
            startedAt: recentActivity,
            status: "active",
            worktreePath: null,
            lastActivityAt: recentActivity,
          },
        ],
        totalSpawned: 1,
      };

      const stuck = findStuckWorkers(pool, 15);
      expect(stuck).toHaveLength(0);
    });
  });

  describe("findDeadTasks", () => {
    it("detects in_progress tasks with no active session", () => {
      let tree = buildWorkTree();
      tree = updateTaskStatus(tree, "t1", "in_progress");

      // Pool has no sessions for t1
      const pool = createWorkerPool();

      const dead = findDeadTasks(tree, pool);
      expect(dead).toHaveLength(1);
      expect(dead[0]!.id).toBe("t1");
    });

    it("does not flag in_progress tasks with active sessions", () => {
      let tree = buildWorkTree();
      tree = updateTaskStatus(tree, "t1", "in_progress");

      let pool = createWorkerPool();
      pool = spawnWorker(pool, "sess-1", "t1");

      const dead = findDeadTasks(tree, pool);
      expect(dead).toHaveLength(0);
    });
  });
});

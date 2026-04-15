import { describe, it, expect } from "vitest";
import {
  getProjectBudgetStatus,
  isTaskWithinBudget,
  isTaskAtSoftLimit,
  checkCircuitBreakers,
} from "./budget.js";
import {
  createWorkTree,
  addMilestone,
  addSlice,
  addTask,
  updateTaskStatus,
  updateTask,
} from "../trees/work-tree.js";
import { defaultConfig } from "../config/defaults.js";
import type { ProjectState, WorkTask } from "../types.js";

function makeState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    status: "running",
    totalTokenSpend: 0,
    totalWorkersSpawned: 0,
    startedAt: "2026-04-07T10:00:00Z",
    pausedAt: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<WorkTask> = {}): WorkTask {
  return {
    id: "t1",
    name: "Test task",
    description: "",
    status: "pending",
    dependencies: [],
    touches: [],
    reads: [],
    worker: null,
    tokenSpend: 0,
    attemptCount: 0,
    gateResults: [],
    parentSliceId: "s1",
    ...overrides,
  };
}

describe("budget", () => {
  describe("getProjectBudgetStatus", () => {
    it("calculates percentage spent", () => {
      const config = defaultConfig("test", "spec.md");
      // Project budget: $100 * 1000 = 100000
      const state = makeState({ totalTokenSpend: 50000 });
      const status = getProjectBudgetStatus(state, config);

      expect(status.totalSpent).toBe(50000);
      expect(status.projectBudget).toBe(100000);
      expect(status.percentage).toBe(50);
      expect(status.atWarning).toBe(false); // 70% threshold
      expect(status.atLimit).toBe(false);
    });

    it("triggers warning at threshold", () => {
      const config = defaultConfig("test", "spec.md");
      // 70% of 100000 = 70000
      const state = makeState({ totalTokenSpend: 70000 });
      const status = getProjectBudgetStatus(state, config);

      expect(status.atWarning).toBe(true);
      expect(status.atLimit).toBe(false);
    });

    it("triggers limit at 100%", () => {
      const config = defaultConfig("test", "spec.md");
      const state = makeState({ totalTokenSpend: 100000 });
      const status = getProjectBudgetStatus(state, config);

      expect(status.atLimit).toBe(true);
    });
  });

  describe("isTaskWithinBudget", () => {
    it("returns true when under budget", () => {
      const config = defaultConfig("test", "spec.md");
      const task = makeTask({ tokenSpend: 500 });
      expect(isTaskWithinBudget(task, config)).toBe(true);
    });

    it("returns false when at or over budget", () => {
      const config = defaultConfig("test", "spec.md");
      // perTask: $5 * 1000 = 5000
      const task = makeTask({ tokenSpend: 5000 });
      expect(isTaskWithinBudget(task, config)).toBe(false);
    });
  });

  describe("isTaskAtSoftLimit", () => {
    it("returns false when under soft limit", () => {
      const config = defaultConfig("test", "spec.md");
      const task = makeTask({ tokenSpend: 500 });
      expect(isTaskAtSoftLimit(task, config)).toBe(false);
    });

    it("returns true when at soft limit", () => {
      const config = defaultConfig("test", "spec.md");
      // perTask: $5, softPct: 75%, so softLimit = 5000 * 0.75 = 3750
      const task = makeTask({ tokenSpend: 3750 });
      expect(isTaskAtSoftLimit(task, config)).toBe(true);
    });
  });

  describe("checkCircuitBreakers", () => {
    it("returns all clear when no failures", () => {
      let tree = createWorkTree();
      tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
      tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
      tree = addTask(tree, "s1", {
        id: "t1",
        name: "T1",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });

      const config = defaultConfig("test", "spec.md");
      const state = makeState();
      const status = checkCircuitBreakers(tree, state, config);

      expect(status.sliceTripped).toBe(false);
      expect(status.projectTripped).toBe(false);
      expect(status.efficiencyTripped).toBe(false);
      expect(status.reason).toBeNull();
    });

    it("trips slice breaker on consecutive failures", () => {
      let tree = createWorkTree();
      tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
      tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
      // Add 3 tasks and fail them all (consecutiveFailuresSlice = 3)
      tree = addTask(tree, "s1", {
        id: "t1",
        name: "T1",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = addTask(tree, "s1", {
        id: "t2",
        name: "T2",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = addTask(tree, "s1", {
        id: "t3",
        name: "T3",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = updateTaskStatus(tree, "t1", "failed");
      tree = updateTaskStatus(tree, "t2", "failed");
      tree = updateTaskStatus(tree, "t3", "failed");

      const config = defaultConfig("test", "spec.md");
      const status = checkCircuitBreakers(tree, makeState(), config);

      expect(status.sliceTripped).toBe(true);
      expect(status.reason).toContain("slice");
    });

    it("does not trip slice breaker if a success interrupts failures", () => {
      let tree = createWorkTree();
      tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
      tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
      tree = addTask(tree, "s1", {
        id: "t1",
        name: "T1",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = addTask(tree, "s1", {
        id: "t2",
        name: "T2",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = addTask(tree, "s1", {
        id: "t3",
        name: "T3",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = updateTaskStatus(tree, "t1", "failed");
      tree = updateTaskStatus(tree, "t2", "complete"); // breaks the streak
      tree = updateTaskStatus(tree, "t3", "failed");

      const config = defaultConfig("test", "spec.md");
      const status = checkCircuitBreakers(tree, makeState(), config);

      expect(status.sliceTripped).toBe(false);
    });

    it("trips project breaker on consecutive failures across project", () => {
      let tree = createWorkTree();
      tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
      tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
      tree = addSlice(tree, "m1", { id: "s2", name: "S2", description: "" });

      // Spread 5 failures across slices (consecutiveFailuresProject = 5)
      for (let i = 1; i <= 5; i++) {
        const sliceId = i <= 2 ? "s1" : "s2";
        tree = addTask(tree, sliceId, {
          id: `t${i}`,
          name: `T${i}`,
          description: "",
          dependencies: [],
          touches: [],
          reads: [],
        });
        tree = updateTaskStatus(tree, `t${i}`, "failed");
      }

      const config = defaultConfig("test", "spec.md");
      const status = checkCircuitBreakers(tree, makeState(), config);

      expect(status.projectTripped).toBe(true);
    });

    it("trips efficiency breaker when completion ratio is low", () => {
      let tree = createWorkTree();
      tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
      tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });

      // 1 complete, 4 failed = 20% efficiency (threshold is 50%)
      tree = addTask(tree, "s1", {
        id: "t1",
        name: "T1",
        description: "",
        dependencies: [],
        touches: [],
        reads: [],
      });
      tree = updateTaskStatus(tree, "t1", "complete");

      for (let i = 2; i <= 5; i++) {
        tree = addTask(tree, "s1", {
          id: `t${i}`,
          name: `T${i}`,
          description: "",
          dependencies: [],
          touches: [],
          reads: [],
        });
        tree = updateTaskStatus(tree, `t${i}`, "failed");
      }

      const config = defaultConfig("test", "spec.md");
      const state = makeState({ totalTokenSpend: 10000 });
      const status = checkCircuitBreakers(tree, state, config);

      expect(status.efficiencyTripped).toBe(true);
    });

    it("does not trip efficiency breaker when no tokens spent", () => {
      const tree = createWorkTree();
      const config = defaultConfig("test", "spec.md");
      const state = makeState({ totalTokenSpend: 0 });

      const status = checkCircuitBreakers(tree, state, config);
      expect(status.efficiencyTripped).toBe(false);
    });
  });

  describe("checkCircuitBreakers with failure classification", () => {
    function buildTreeWithTasks(taskOverrides: Partial<WorkTask>[]) {
      let tree = createWorkTree();
      tree = addMilestone(tree, { id: "m1", name: "M1", description: "", dependencies: [] });
      tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
      for (let i = 0; i < taskOverrides.length; i++) {
        const o = taskOverrides[i]!;
        const id = `t${i + 1}`;
        tree = addTask(tree, "s1", {
          id,
          name: `T${i + 1}`,
          description: "",
          dependencies: [],
          touches: [],
          reads: [],
        });
        if (o.status === "complete") tree = updateTaskStatus(tree, id, "complete");
        if (o.status === "failed") {
          tree = updateTaskStatus(tree, id, "failed");
          tree = updateTask(tree, id, {
            failureKind: o.failureKind,
            failureMessage: o.failureMessage,
          });
        }
      }
      return tree;
    }

    it("excludes infra failures from efficiency calculation", () => {
      const tree = buildTreeWithTasks([
        { status: "complete" },
        { status: "failed", failureKind: "infra", failureMessage: "AWS outage" },
        { status: "failed", failureKind: "infra", failureMessage: "AWS outage" },
        { status: "failed", failureKind: "infra", failureMessage: "AWS outage" },
      ]);
      const config = defaultConfig("test", "spec.md");
      const state = makeState({ totalTokenSpend: 10000 });
      const status = checkCircuitBreakers(tree, state, config);

      expect(status.efficiencyTripped).toBe(false);
    });

    it("counts code failures in efficiency calculation", () => {
      const tree = buildTreeWithTasks([
        { status: "complete" },
        { status: "failed", failureKind: "code", failureMessage: "type error" },
        { status: "failed", failureKind: "code", failureMessage: "type error" },
        { status: "failed", failureKind: "code", failureMessage: "type error" },
      ]);
      const config = defaultConfig("test", "spec.md");
      const state = makeState({ totalTokenSpend: 10000 });
      const status = checkCircuitBreakers(tree, state, config);

      expect(status.efficiencyTripped).toBe(true);
    });

    it("detects infra breaker on repeated same-message infra failures", () => {
      const tree = buildTreeWithTasks([
        { status: "failed", failureKind: "infra", failureMessage: "connection refused" },
        { status: "failed", failureKind: "infra", failureMessage: "connection refused" },
      ]);
      const config = defaultConfig("test", "spec.md");
      const state = makeState({ totalTokenSpend: 10000 });
      const status = checkCircuitBreakers(tree, state, config);

      expect(status.infraTripped).toBe(true);
      expect(status.reason).toContain("Infrastructure issue");
    });
  });
});

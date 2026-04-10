import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedReadyTasks,
  setCachedReadyTasks,
  invalidateReadinessCache,
} from "./readiness-cache.js";
import type { WorkTree, WorkTask } from "../types.js";

function makeTree(milestoneCount: number, taskStatus: string = "pending"): WorkTree {
  return {
    milestones: Array.from({ length: milestoneCount }, (_, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      description: "",
      dependencies: [],
      slices: [
        {
          id: `s${i}`,
          name: `S${i}`,
          description: "",
          parentMilestoneId: `m${i}`,
          tasks: [
            {
              ...makeTask(`t-m${i}`),
              status: taskStatus as "pending" | "in_progress" | "complete" | "failed" | "paused",
            },
          ],
        },
      ],
    })),
  };
}

function makeTask(id: string): WorkTask {
  return {
    id,
    name: id,
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
  };
}

describe("readiness-cache", () => {
  beforeEach(() => {
    invalidateReadinessCache();
  });

  it("returns null when empty", () => {
    expect(getCachedReadyTasks(makeTree(1), [])).toBeNull();
  });

  it("returns cached tasks when tree hash matches", () => {
    const tree = makeTree(2);
    const tasks = [makeTask("t1"), makeTask("t2")];
    setCachedReadyTasks(tasks, tree, ["a.ts"]);
    expect(getCachedReadyTasks(tree, ["a.ts"])).toEqual(tasks);
  });

  it("returns null when tree structure changes", () => {
    const tree1 = makeTree(2);
    const tree2 = makeTree(3);
    const tasks = [makeTask("t1")];
    setCachedReadyTasks(tasks, tree1, []);
    expect(getCachedReadyTasks(tree2, [])).toBeNull();
  });

  it("returns null when file locks change", () => {
    const tree = makeTree(2);
    const tasks = [makeTask("t1")];
    setCachedReadyTasks(tasks, tree, ["a.ts"]);
    expect(getCachedReadyTasks(tree, ["a.ts", "b.ts"])).toBeNull();
  });

  it("returns null when task status changes", () => {
    const tree1 = makeTree(1, "pending");
    const tree2 = makeTree(1, "complete");
    const tasks = [makeTask("t1")];
    setCachedReadyTasks(tasks, tree1, []);
    expect(getCachedReadyTasks(tree2, [])).toBeNull();
  });

  it("invalidates cache", () => {
    const tree = makeTree(1);
    setCachedReadyTasks([makeTask("t1")], tree, []);
    invalidateReadinessCache();
    expect(getCachedReadyTasks(tree, [])).toBeNull();
  });
});

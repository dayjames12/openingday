import { describe, it, expect } from "vitest";
import {
  createWorkTree,
  addMilestone,
  addSlice,
  addTask,
  getAllTasks,
  getTasksInSlice,
  getTask,
  updateTaskStatus,
  updateTask,
  getReadyTasks,
  splitTask,
} from "./work-tree.js";

describe("work-tree", () => {
  // 1. Creates empty work tree
  it("creates an empty work tree", () => {
    const tree = createWorkTree();
    expect(tree).toEqual({ milestones: [] });
  });

  // 2. Adds milestone
  it("adds a milestone", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "Auth",
      description: "Authentication milestone",
      dependencies: [],
    });
    expect(tree.milestones).toHaveLength(1);
    expect(tree.milestones[0].id).toBe("m1");
    expect(tree.milestones[0].name).toBe("Auth");
    expect(tree.milestones[0].slices).toEqual([]);
  });

  // 3. Adds slice to milestone
  it("adds a slice to a milestone", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "Auth",
      description: "Authentication",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", {
      id: "s1",
      name: "JWT",
      description: "JWT implementation",
    });
    expect(tree.milestones[0].slices).toHaveLength(1);
    expect(tree.milestones[0].slices[0].id).toBe("s1");
    expect(tree.milestones[0].slices[0].parentMilestoneId).toBe("m1");
    expect(tree.milestones[0].slices[0].tasks).toEqual([]);
  });

  // 4. Adds task to slice with correct defaults
  it("adds a task to a slice with default values", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "Auth",
      description: "Auth",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", {
      id: "s1",
      name: "JWT",
      description: "JWT",
    });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Middleware",
      description: "JWT middleware",
      dependencies: [],
      touches: ["auth/middleware.ts"],
      reads: ["auth/types.ts"],
    });

    const task = tree.milestones[0].slices[0].tasks[0];
    expect(task.id).toBe("t1");
    expect(task.status).toBe("pending");
    expect(task.worker).toBeNull();
    expect(task.tokenSpend).toBe(0);
    expect(task.attemptCount).toBe(0);
    expect(task.gateResults).toEqual([]);
    expect(task.parentSliceId).toBe("s1");
    expect(task.touches).toEqual(["auth/middleware.ts"]);
    expect(task.reads).toEqual(["auth/types.ts"]);
  });

  // 5. Gets task by id
  it("gets a task by id", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "First task",
      dependencies: [],
      touches: [],
      reads: [],
    });

    const task = getTask(tree, "t1");
    expect(task).not.toBeNull();
    expect(task!.name).toBe("Task 1");
  });

  // 6. Returns null for nonexistent task
  it("returns null for nonexistent task", () => {
    const tree = createWorkTree();
    expect(getTask(tree, "nope")).toBeNull();
  });

  // 7. Updates task status
  it("updates task status", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "",
      dependencies: [],
      touches: [],
      reads: [],
    });

    tree = updateTaskStatus(tree, "t1", "in_progress");
    expect(getTask(tree, "t1")!.status).toBe("in_progress");

    tree = updateTaskStatus(tree, "t1", "complete");
    expect(getTask(tree, "t1")!.status).toBe("complete");
  });

  // 8. Finds ready tasks (pending, deps met)
  it("finds ready tasks with no dependencies", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "",
      dependencies: [],
      touches: ["a.ts"],
      reads: [],
    });
    tree = addTask(tree, "s1", {
      id: "t2",
      name: "Task 2",
      description: "",
      dependencies: [],
      touches: ["b.ts"],
      reads: [],
    });

    const ready = getReadyTasks(tree, []);
    expect(ready).toHaveLength(2);
    expect(ready.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  // 9. Blocks tasks with unmet dependencies
  it("blocks tasks with unmet dependencies", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "",
      dependencies: [],
      touches: [],
      reads: [],
    });
    tree = addTask(tree, "s1", {
      id: "t2",
      name: "Task 2",
      description: "",
      dependencies: ["t1"],
      touches: [],
      reads: [],
    });

    const ready = getReadyTasks(tree, []);
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("t1");
  });

  // 10. After completing dependency, blocked task becomes ready
  it("unblocks task after dependency completes", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "",
      dependencies: [],
      touches: [],
      reads: [],
    });
    tree = addTask(tree, "s1", {
      id: "t2",
      name: "Task 2",
      description: "",
      dependencies: ["t1"],
      touches: [],
      reads: [],
    });

    // Before completing t1
    expect(getReadyTasks(tree, []).map((t) => t.id)).toEqual(["t1"]);

    // Complete t1
    tree = updateTaskStatus(tree, "t1", "complete");

    const ready = getReadyTasks(tree, []);
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("t2");
  });

  // 11. Excludes tasks with file conflicts from ready list
  it("excludes tasks with file conflicts from ready list", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "",
      dependencies: [],
      touches: ["shared.ts"],
      reads: [],
    });
    tree = addTask(tree, "s1", {
      id: "t2",
      name: "Task 2",
      description: "",
      dependencies: [],
      touches: ["other.ts"],
      reads: [],
    });

    const ready = getReadyTasks(tree, ["shared.ts"]);
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("t2");
  });

  // 12. Splits task into subtasks
  it("splits task into subtasks", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Big task",
      description: "Original",
      dependencies: [],
      touches: ["a.ts", "b.ts"],
      reads: [],
    });
    tree = addTask(tree, "s1", {
      id: "t-after",
      name: "After task",
      description: "Depends on t1",
      dependencies: ["t1"],
      touches: ["c.ts"],
      reads: [],
    });

    tree = splitTask(tree, "t1", [
      {
        id: "t1a",
        name: "Sub A",
        description: "First sub",
        dependencies: [],
        touches: ["a.ts"],
        reads: [],
      },
      {
        id: "t1b",
        name: "Sub B",
        description: "Second sub",
        dependencies: ["t1a"],
        touches: ["b.ts"],
        reads: [],
      },
    ]);

    // Original task removed
    expect(getTask(tree, "t1")).toBeNull();

    // New tasks exist in the same slice
    const sliceTasks = getTasksInSlice(tree, "s1");
    expect(sliceTasks.map((t) => t.id)).toEqual(["t1a", "t1b", "t-after"]);

    // New tasks have correct parentSliceId
    expect(getTask(tree, "t1a")!.parentSliceId).toBe("s1");
    expect(getTask(tree, "t1b")!.parentSliceId).toBe("s1");

    // Dependency on original task now points to last new task
    const afterTask = getTask(tree, "t-after")!;
    expect(afterTask.dependencies).toEqual(["t1b"]);
  });

  // Additional: getAllTasks and getTasksInSlice
  it("getAllTasks returns flat array across milestones and slices", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addMilestone(tree, {
      id: "m2",
      name: "M2",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addSlice(tree, "m2", { id: "s2", name: "S2", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "T1",
      description: "",
      dependencies: [],
      touches: [],
      reads: [],
    });
    tree = addTask(tree, "s2", {
      id: "t2",
      name: "T2",
      description: "",
      dependencies: [],
      touches: [],
      reads: [],
    });

    const all = getAllTasks(tree);
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("updateTask applies partial updates", () => {
    let tree = createWorkTree();
    tree = addMilestone(tree, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    tree = addSlice(tree, "m1", { id: "s1", name: "S1", description: "" });
    tree = addTask(tree, "s1", {
      id: "t1",
      name: "Task 1",
      description: "",
      dependencies: [],
      touches: [],
      reads: [],
    });

    tree = updateTask(tree, "t1", {
      worker: "session-42",
      tokenSpend: 1500,
      attemptCount: 1,
    });

    const task = getTask(tree, "t1")!;
    expect(task.worker).toBe("session-42");
    expect(task.tokenSpend).toBe(1500);
    expect(task.attemptCount).toBe(1);
    // Unchanged fields preserved
    expect(task.status).toBe("pending");
    expect(task.name).toBe("Task 1");
  });

  it("returns immutable trees (original unchanged)", () => {
    const tree1 = createWorkTree();
    const tree2 = addMilestone(tree1, {
      id: "m1",
      name: "M1",
      description: "",
      dependencies: [],
    });
    expect(tree1.milestones).toHaveLength(0);
    expect(tree2.milestones).toHaveLength(1);
  });
});

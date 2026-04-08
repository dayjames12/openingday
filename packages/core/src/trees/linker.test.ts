import { describe, it, expect } from "vitest";
import {
  resolveTaskTouches,
  resolveTaskReads,
  findTasksTouchingFile,
  findTasksReadingFile,
  detectFileConflicts,
  getActiveFileLocks,
  validateFileReferences,
} from "./linker.js";
import { createWorkTree, addMilestone, addSlice, addTask, updateTaskStatus } from "./work-tree.js";
import { createCodeTree, addModule, addFile } from "./code-tree.js";
import type { WorkTree, CodeTree } from "../types.js";

function buildFixture(): { workTree: WorkTree; codeTree: CodeTree } {
  let codeTree = createCodeTree();
  codeTree = addModule(codeTree, { path: "src/auth", description: "Auth" });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/middleware.ts",
    description: "MW",
    exports: [{ name: "authMiddleware", signature: "() => MW", description: "" }],
    imports: [{ from: "src/auth/types.ts", names: ["Token"] }],
  });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/types.ts",
    description: "Types",
    exports: [{ name: "Token", signature: "interface", description: "" }],
    imports: [],
  });

  let workTree = createWorkTree();
  workTree = addMilestone(workTree, { id: "m1", name: "Auth", description: "", dependencies: [] });
  workTree = addSlice(workTree, "m1", { id: "s1", name: "JWT", description: "" });
  workTree = addTask(workTree, "s1", {
    id: "t1",
    name: "Middleware",
    description: "",
    dependencies: [],
    touches: ["src/auth/middleware.ts"],
    reads: ["src/auth/types.ts"],
  });
  workTree = addTask(workTree, "s1", {
    id: "t2",
    name: "Types update",
    description: "",
    dependencies: [],
    touches: ["src/auth/types.ts"],
    reads: [],
  });

  return { workTree, codeTree };
}

describe("linker", () => {
  it("resolveTaskTouches returns code files for task touches", () => {
    const { workTree, codeTree } = buildFixture();
    const files = resolveTaskTouches(workTree, codeTree, "t1");
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/auth/middleware.ts");
  });

  it("resolveTaskReads returns code files for task reads", () => {
    const { workTree, codeTree } = buildFixture();
    const files = resolveTaskReads(workTree, codeTree, "t1");
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/auth/types.ts");
  });

  it("resolveTaskTouches returns empty for nonexistent task", () => {
    const { workTree, codeTree } = buildFixture();
    expect(resolveTaskTouches(workTree, codeTree, "nope")).toEqual([]);
  });

  it("findTasksTouchingFile returns tasks that touch a file", () => {
    const { workTree } = buildFixture();
    const tasks = findTasksTouchingFile(workTree, "src/auth/middleware.ts");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("t1");
  });

  it("findTasksReadingFile returns tasks that read a file", () => {
    const { workTree } = buildFixture();
    const tasks = findTasksReadingFile(workTree, "src/auth/types.ts");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("t1");
  });

  it("detectFileConflicts finds files touched by multiple active tasks", () => {
    let { workTree } = buildFixture();
    // Add a second task that also touches middleware.ts
    workTree = addTask(workTree, "s1", {
      id: "t3",
      name: "Also MW",
      description: "",
      dependencies: [],
      touches: ["src/auth/middleware.ts"],
      reads: [],
    });

    const conflicts = detectFileConflicts(workTree);
    expect(conflicts.has("src/auth/middleware.ts")).toBe(true);
    expect(conflicts.get("src/auth/middleware.ts")!.sort()).toEqual(["t1", "t3"]);
  });

  it("detectFileConflicts ignores completed tasks", () => {
    let { workTree } = buildFixture();
    workTree = addTask(workTree, "s1", {
      id: "t3",
      name: "Also MW",
      description: "",
      dependencies: [],
      touches: ["src/auth/middleware.ts"],
      reads: [],
    });
    // Complete t1 so only t3 touches middleware
    workTree = updateTaskStatus(workTree, "t1", "complete");

    const conflicts = detectFileConflicts(workTree);
    expect(conflicts.has("src/auth/middleware.ts")).toBe(false);
  });

  it("getActiveFileLocks returns files touched by in_progress tasks", () => {
    let { workTree } = buildFixture();
    workTree = updateTaskStatus(workTree, "t1", "in_progress");

    const locks = getActiveFileLocks(workTree);
    expect(locks).toContain("src/auth/middleware.ts");
    expect(locks).not.toContain("src/auth/types.ts"); // t2 is pending, not in_progress
  });

  it("getActiveFileLocks returns empty when no tasks in progress", () => {
    const { workTree } = buildFixture();
    expect(getActiveFileLocks(workTree)).toEqual([]);
  });

  it("validateFileReferences detects missing code tree files", () => {
    let workTree = createWorkTree();
    workTree = addMilestone(workTree, { id: "m1", name: "M1", description: "", dependencies: [] });
    workTree = addSlice(workTree, "m1", { id: "s1", name: "S1", description: "" });
    workTree = addTask(workTree, "s1", {
      id: "t1",
      name: "T1",
      description: "",
      dependencies: [],
      touches: ["exists.ts", "missing-touch.ts"],
      reads: ["exists.ts", "missing-read.ts"],
    });

    let codeTree = createCodeTree();
    codeTree = addModule(codeTree, { path: "src", description: "" });
    codeTree = addFile(codeTree, "src", {
      path: "exists.ts",
      description: "",
      exports: [],
      imports: [],
    });

    const missing = validateFileReferences(workTree, codeTree);
    expect(missing).toHaveLength(2);
    expect(missing).toContainEqual({ taskId: "t1", path: "missing-touch.ts", type: "touches" });
    expect(missing).toContainEqual({ taskId: "t1", path: "missing-read.ts", type: "reads" });
  });

  it("validateFileReferences returns empty when all references valid", () => {
    const { workTree, codeTree } = buildFixture();
    expect(validateFileReferences(workTree, codeTree)).toEqual([]);
  });
});

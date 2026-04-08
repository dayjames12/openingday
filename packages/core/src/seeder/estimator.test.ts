import { describe, it, expect } from "vitest";
import { estimateTaskContext, findOversizedTasks } from "./estimator.js";
import { createWorkTree, addMilestone, addSlice, addTask } from "../trees/work-tree.js";
import { createCodeTree, addModule, addFile } from "../trees/code-tree.js";
import type { WorkTree, CodeTree } from "../types.js";

function buildTestTrees(): { workTree: WorkTree; codeTree: CodeTree } {
  let workTree = createWorkTree();
  workTree = addMilestone(workTree, {
    id: "m1",
    name: "Auth",
    description: "Authentication",
    dependencies: [],
  });
  workTree = addSlice(workTree, "m1", {
    id: "m1-s1",
    name: "JWT",
    description: "JWT implementation",
  });
  workTree = addTask(workTree, "m1-s1", {
    id: "m1-s1-t1",
    name: "Create middleware",
    description: "Implement JWT middleware",
    dependencies: [],
    touches: ["src/auth/middleware.ts"],
    reads: ["src/auth/types.ts"],
  });

  let codeTree = createCodeTree();
  codeTree = addModule(codeTree, { path: "src/auth", description: "Auth module" });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/middleware.ts",
    description: "JWT middleware",
    exports: [
      { name: "authMiddleware", signature: "(opts: AuthOpts) => Middleware", description: "Main auth middleware" },
    ],
    imports: [{ from: "./types.js", names: ["AuthOpts"] }],
  });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/types.ts",
    description: "Auth types",
    exports: [
      { name: "AuthOpts", signature: "interface AuthOpts", description: "Auth options" },
    ],
    imports: [],
  });

  return { workTree, codeTree };
}

describe("estimator", () => {
  describe("estimateTaskContext", () => {
    it("estimates context for a small task (>0, <150k)", () => {
      const { workTree, codeTree } = buildTestTrees();
      const tokens = estimateTaskContext(workTree, codeTree, "m1-s1-t1");
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(150_000);
    });

    it("returns 0 for nonexistent task", () => {
      const { workTree, codeTree } = buildTestTrees();
      const tokens = estimateTaskContext(workTree, codeTree, "nonexistent");
      expect(tokens).toBe(0);
    });
  });

  describe("findOversizedTasks", () => {
    it("returns empty array when all tasks fit within default limit", () => {
      const { workTree, codeTree } = buildTestTrees();
      const oversized = findOversizedTasks(workTree, codeTree);
      expect(oversized).toHaveLength(0);
    });

    it("finds oversized tasks when limit is set very low", () => {
      const { workTree, codeTree } = buildTestTrees();
      // Set limit to 1 token -- everything should be oversized
      const oversized = findOversizedTasks(workTree, codeTree, 1);
      expect(oversized.length).toBeGreaterThan(0);
      expect(oversized[0]!.taskId).toBe("m1-s1-t1");
      expect(oversized[0]!.estimatedTokens).toBeGreaterThan(1);
      expect(oversized[0]!.limit).toBe(1);
    });
  });
});

import { describe, it, expect } from "vitest";
import { buildContext } from "./context-builder.js";
import { createWorkTree, addMilestone, addSlice, addTask } from "../trees/work-tree.js";
import { createCodeTree, addModule, addFile } from "../trees/code-tree.js";
import { defaultConfig } from "../config/defaults.js";
import type { WorkTree, CodeTree, ProjectConfig } from "../types.js";

function buildFixture(): { workTree: WorkTree; codeTree: CodeTree; config: ProjectConfig } {
  let codeTree = createCodeTree();
  codeTree = addModule(codeTree, { path: "src/auth", description: "Auth" });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/types.ts",
    description: "Auth types",
    exports: [{ name: "AuthOpts", signature: "interface AuthOpts", description: "Opts" }],
    imports: [],
  });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/middleware.ts",
    description: "JWT middleware",
    exports: [{ name: "authMiddleware", signature: "() => MW", description: "MW" }],
    imports: [{ from: "src/auth/types.ts", names: ["AuthOpts"] }],
  });
  codeTree = addFile(codeTree, "src/auth", {
    path: "src/auth/routes.ts",
    description: "Auth routes",
    exports: [{ name: "authRoutes", signature: "() => Router", description: "Routes" }],
    imports: [{ from: "src/auth/middleware.ts", names: ["authMiddleware"] }],
  });

  let workTree = createWorkTree();
  workTree = addMilestone(workTree, { id: "m1", name: "Auth", description: "", dependencies: [] });
  workTree = addSlice(workTree, "m1", { id: "s1", name: "JWT", description: "" });
  workTree = addTask(workTree, "s1", {
    id: "t1",
    name: "JWT middleware",
    description: "Implement JWT auth middleware",
    dependencies: [],
    touches: ["src/auth/middleware.ts"],
    reads: ["src/auth/types.ts"],
  });

  const config = defaultConfig("test-project", "spec.md");

  return { workTree, codeTree, config };
}

describe("context-builder", () => {
  it("builds a context package for a valid task", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "memory text", "rules text");

    expect(ctx).not.toBeNull();
    expect(ctx!.task.name).toBe("JWT middleware");
    expect(ctx!.task.description).toBe("Implement JWT auth middleware");
    expect(ctx!.memory).toBe("memory text");
    expect(ctx!.rules).toBe("rules text");
  });

  it("returns null for nonexistent task", () => {
    const { workTree, codeTree, config } = buildFixture();
    expect(buildContext(workTree, codeTree, config, "nope", "", "")).toBeNull();
  });

  it("includes touched files as interfaces", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    expect(ctx.interfaces).toHaveLength(1);
    expect(ctx.interfaces[0].path).toBe("src/auth/middleware.ts");
  });

  it("includes dependencies and reads as above files", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    // types.ts is both a dependency of middleware.ts and an explicit read
    expect(ctx.above.map((f) => f.path)).toContain("src/auth/types.ts");
  });

  it("includes dependents as below files", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    // routes.ts imports from middleware.ts
    expect(ctx.below.map((f) => f.path)).toContain("src/auth/routes.ts");
  });

  it("does not duplicate files across interfaces, above, and below", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    const allPaths = [
      ...ctx.interfaces.map((f) => f.path),
      ...ctx.above.map((f) => f.path),
      ...ctx.below.map((f) => f.path),
    ];
    const unique = new Set(allPaths);
    expect(allPaths.length).toBe(unique.size);
  });

  it("computes budget from config", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    // perTask: $2, softPct: 75%, so softLimit = 2 * 0.75 * 1000 = 1500
    expect(ctx.budget.softLimit).toBe(1500);
    // hardLimit = 2 * 1000 = 2000
    expect(ctx.budget.hardLimit).toBe(2000);
  });

  it("builds acceptance criteria from task", () => {
    const { workTree, codeTree, config } = buildFixture();
    const ctx = buildContext(workTree, codeTree, config, "t1", "", "")!;

    expect(ctx.task.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(ctx.task.acceptanceCriteria[0]).toContain("JWT middleware");
  });
});

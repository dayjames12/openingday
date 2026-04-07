import { describe, it, expect } from "vitest";
import {
  createCodeTree,
  addModule,
  getModule,
  addFile,
  getFile,
  getAllFiles,
  updateFile,
  setLastModifiedBy,
  getFileExports,
  getFileImports,
  getDependents,
  getDependencies,
} from "./code-tree.js";

describe("code-tree", () => {
  it("creates an empty code tree", () => {
    const tree = createCodeTree();
    expect(tree).toEqual({ modules: [] });
  });

  it("adds a module", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth module" });
    expect(tree.modules).toHaveLength(1);
    expect(tree.modules[0].path).toBe("src/auth");
    expect(tree.modules[0].files).toEqual([]);
  });

  it("gets a module by path", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    expect(getModule(tree, "src/auth")).not.toBeNull();
    expect(getModule(tree, "src/nope")).toBeNull();
  });

  it("adds a file to a module", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/middleware.ts",
      description: "JWT middleware",
      exports: [{ name: "authMiddleware", signature: "() => Middleware", description: "Auth MW" }],
      imports: [{ from: "src/auth/types", names: ["AuthOpts"] }],
    });
    expect(tree.modules[0].files).toHaveLength(1);
    expect(tree.modules[0].files[0].lastModifiedBy).toBeNull();
  });

  it("gets a file by path", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Auth types",
      exports: [{ name: "AuthOpts", signature: "interface AuthOpts", description: "Options" }],
      imports: [],
    });
    const file = getFile(tree, "src/auth/types.ts");
    expect(file).not.toBeNull();
    expect(file!.description).toBe("Auth types");
    expect(getFile(tree, "nope")).toBeNull();
  });

  it("getAllFiles returns flat array across modules", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addModule(tree, { path: "src/api", description: "API" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Types",
      exports: [],
      imports: [],
    });
    tree = addFile(tree, "src/api", {
      path: "src/api/routes.ts",
      description: "Routes",
      exports: [],
      imports: [],
    });
    expect(getAllFiles(tree)).toHaveLength(2);
  });

  it("updates a file", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Auth types",
      exports: [],
      imports: [],
    });
    tree = updateFile(tree, "src/auth/types.ts", {
      description: "Updated auth types",
      exports: [{ name: "Token", signature: "interface Token", description: "JWT token" }],
    });
    const file = getFile(tree, "src/auth/types.ts")!;
    expect(file.description).toBe("Updated auth types");
    expect(file.exports).toHaveLength(1);
  });

  it("sets lastModifiedBy", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Types",
      exports: [],
      imports: [],
    });
    tree = setLastModifiedBy(tree, "src/auth/types.ts", "task-42");
    expect(getFile(tree, "src/auth/types.ts")!.lastModifiedBy).toBe("task-42");
  });

  it("getFileExports returns exports or empty array", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Types",
      exports: [{ name: "Token", signature: "interface Token", description: "JWT" }],
      imports: [],
    });
    expect(getFileExports(tree, "src/auth/types.ts")).toHaveLength(1);
    expect(getFileExports(tree, "nope")).toEqual([]);
  });

  it("getFileImports returns imports or empty array", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/middleware.ts",
      description: "MW",
      exports: [],
      imports: [{ from: "src/auth/types", names: ["Token"] }],
    });
    expect(getFileImports(tree, "src/auth/middleware.ts")).toHaveLength(1);
    expect(getFileImports(tree, "nope")).toEqual([]);
  });

  it("getDependents finds files that import from a given path", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Types",
      exports: [{ name: "Token", signature: "interface", description: "" }],
      imports: [],
    });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/middleware.ts",
      description: "MW",
      exports: [],
      imports: [{ from: "src/auth/types.ts", names: ["Token"] }],
    });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/utils.ts",
      description: "Utils",
      exports: [],
      imports: [{ from: "src/auth/types.ts", names: ["Token"] }],
    });

    const deps = getDependents(tree, "src/auth/types.ts");
    expect(deps).toHaveLength(2);
    expect(deps.map((f) => f.path).sort()).toEqual([
      "src/auth/middleware.ts",
      "src/auth/utils.ts",
    ]);
  });

  it("getDependencies finds files that a given file imports from", () => {
    let tree = createCodeTree();
    tree = addModule(tree, { path: "src/auth", description: "Auth" });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Types",
      exports: [],
      imports: [],
    });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/config.ts",
      description: "Config",
      exports: [],
      imports: [],
    });
    tree = addFile(tree, "src/auth", {
      path: "src/auth/middleware.ts",
      description: "MW",
      exports: [],
      imports: [
        { from: "src/auth/types.ts", names: ["Token"] },
        { from: "src/auth/config.ts", names: ["Config"] },
      ],
    });

    const deps = getDependencies(tree, "src/auth/middleware.ts");
    expect(deps).toHaveLength(2);
    expect(deps.map((f) => f.path).sort()).toEqual([
      "src/auth/config.ts",
      "src/auth/types.ts",
    ]);
  });

  it("getDependencies returns empty for nonexistent file", () => {
    const tree = createCodeTree();
    expect(getDependencies(tree, "nope")).toEqual([]);
  });

  it("returns immutable trees", () => {
    const t1 = createCodeTree();
    const t2 = addModule(t1, { path: "src/auth", description: "Auth" });
    expect(t1.modules).toHaveLength(0);
    expect(t2.modules).toHaveLength(1);
  });
});

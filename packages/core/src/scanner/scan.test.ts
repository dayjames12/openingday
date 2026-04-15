import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanRepo, detectPackageBuildConfigs } from "./scan.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("tiered scanner", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "od-scan-"));
    // Create a mini project
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { hono: "^4.0.0" },
      }),
    );
    await writeFile(join(dir, "tsconfig.json"), "{}");
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "auth.ts"),
      "export function login(user: string): boolean { return true; }\nexport interface User { id: string; }\n",
    );
    await writeFile(
      join(dir, "src", "api.ts"),
      'import { login } from "./auth";\nexport function handler() { login("x"); }\n',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("lite scan: captures file structure and exports", async () => {
    const map = await scanRepo(dir, "lite");
    expect(map.depth).toBe("lite");
    expect(map.env.pm).toBe("npm"); // lite skips env detection
    expect(map.modules.length).toBeGreaterThanOrEqual(1);
    const allFiles = map.modules.flatMap((m) => m.files);
    const authFile = allFiles.find((f) => f.p.includes("auth.ts"));
    expect(authFile).toBeDefined();
    expect(authFile!.ex.some((e) => e.n === "login")).toBe(true);
    expect(authFile!.loc).toBeGreaterThan(0);
  });

  it("standard scan: captures env + deps + structure", async () => {
    const map = await scanRepo(dir, "standard");
    expect(map.depth).toBe("standard");
    expect(map.env.pm).toBe("pnpm");
    expect(map.env.ts).toBe(true);
    expect(map.deps).toContain("hono");
  });

  it("calculates module keywords from export names", async () => {
    const map = await scanRepo(dir, "lite");
    const srcModule = map.modules.find((m) => m.p === "src");
    expect(srcModule).toBeDefined();
    expect(srcModule!.k.length).toBeGreaterThan(0);
  });

  it("generates landscape index", async () => {
    const map = await scanRepo(dir, "standard");
    expect(map.modules.every((m) => typeof m.fc === "number")).toBe(true);
  });
});

describe("detectPackageBuildConfigs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "od-scan-pkg-"));
    await mkdir(join(dir, "packages"), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("detects bundler moduleResolution as not tsc-compatible", async () => {
    await mkdir(join(dir, "packages", "dashboard"), { recursive: true });
    await writeFile(
      join(dir, "packages", "dashboard", "tsconfig.json"),
      JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } }),
    );
    await writeFile(
      join(dir, "packages", "dashboard", "package.json"),
      JSON.stringify({ name: "dashboard", scripts: { build: "vite build" } }),
    );

    const configs = await detectPackageBuildConfigs(dir);
    expect(configs["dashboard"]).toBeDefined();
    expect(configs["dashboard"]!.tscCompatible).toBe(false);
    expect(configs["dashboard"]!.moduleResolution).toBe("bundler");
    expect(configs["dashboard"]!.bundler).toBe("vite");
  });

  it("detects standard moduleResolution as tsc-compatible", async () => {
    await mkdir(join(dir, "packages", "core"), { recursive: true });
    await writeFile(
      join(dir, "packages", "core", "tsconfig.json"),
      JSON.stringify({ compilerOptions: { moduleResolution: "node16" } }),
    );
    await writeFile(
      join(dir, "packages", "core", "package.json"),
      JSON.stringify({ name: "core", scripts: { build: "tsc -p tsconfig.json" } }),
    );

    const configs = await detectPackageBuildConfigs(dir);
    expect(configs["core"]).toBeDefined();
    expect(configs["core"]!.tscCompatible).toBe(true);
    expect(configs["core"]!.moduleResolution).toBe("node16");
    expect(configs["core"]!.bundler).toBeUndefined();
  });

  it("marks package without tsconfig as not tsc-compatible", async () => {
    await mkdir(join(dir, "packages", "scripts"), { recursive: true });
    await writeFile(
      join(dir, "packages", "scripts", "package.json"),
      JSON.stringify({ name: "scripts", scripts: { build: "esbuild src/index.ts" } }),
    );

    const configs = await detectPackageBuildConfigs(dir);
    expect(configs["scripts"]).toBeDefined();
    expect(configs["scripts"]!.tscCompatible).toBe(false);
    expect(configs["scripts"]!.bundler).toBe("esbuild");
  });

  it("detects vite bundler from package.json scripts", async () => {
    await mkdir(join(dir, "packages", "app"), { recursive: true });
    await writeFile(
      join(dir, "packages", "app", "tsconfig.json"),
      JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } }),
    );
    await writeFile(
      join(dir, "packages", "app", "package.json"),
      JSON.stringify({ name: "app", scripts: { build: "vite build --mode production" } }),
    );

    const configs = await detectPackageBuildConfigs(dir);
    expect(configs["app"]!.bundler).toBe("vite");
  });

  it("wires packageConfigs into scanRepo result for monorepos", async () => {
    await mkdir(join(dir, "packages", "ui"), { recursive: true });
    await writeFile(
      join(dir, "packages", "ui", "tsconfig.json"),
      JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } }),
    );
    await writeFile(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "ui", scripts: { build: "vite build" } }),
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    );
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    const map = await scanRepo(dir, "standard");
    expect(map.packageConfigs).toBeDefined();
    expect(map.packageConfigs!["ui"]).toBeDefined();
    expect(map.packageConfigs!["ui"]!.tscCompatible).toBe(false);
  });
});

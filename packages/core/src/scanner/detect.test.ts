import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectEnv, detectDeps } from "./detect.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("detect", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "od-detect-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("detects pnpm from lockfile", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    const env = await detectEnv(dir);
    expect(env.pm).toBe("pnpm");
  });

  it("detects npm as fallback", async () => {
    const env = await detectEnv(dir);
    expect(env.pm).toBe("npm");
  });

  it("detects vitest from config file", async () => {
    await writeFile(join(dir, "vitest.config.ts"), "");
    const env = await detectEnv(dir);
    expect(env.test).toBe("vitest");
  });

  it("detects eslint from config file", async () => {
    await writeFile(join(dir, "eslint.config.js"), "");
    const env = await detectEnv(dir);
    expect(env.lint).toBe("eslint");
  });

  it("detects TypeScript from tsconfig", async () => {
    await writeFile(join(dir, "tsconfig.json"), "{}");
    const env = await detectEnv(dir);
    expect(env.ts).toBe(true);
  });

  it("detects monorepo from pnpm-workspace.yaml", async () => {
    await writeFile(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"');
    const env = await detectEnv(dir);
    expect(env.monorepo).toBe(true);
    expect(env.workspaces).toContain("packages/*");
  });

  it("detects SST infra", async () => {
    await writeFile(join(dir, "sst.config.ts"), "");
    const env = await detectEnv(dir);
    expect(env.infra).toBe("sst");
  });

  it("reads deps from package.json", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { hono: "^4.0.0", electrodb: "^3.0.0" },
        devDependencies: { vitest: "^4.0.0" },
      }),
    );
    const deps = await detectDeps(dir);
    expect(deps).toContain("hono");
    expect(deps).toContain("electrodb");
    expect(deps).not.toContain("vitest"); // devDeps excluded from deps list
  });
});

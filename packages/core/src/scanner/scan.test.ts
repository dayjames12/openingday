import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanRepo } from "./scan.js";
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

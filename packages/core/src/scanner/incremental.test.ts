import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { refreshFiles } from "./incremental.js";
import { scanRepo } from "./scan.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("incremental refresh", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "od-incr-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "auth.ts"), "export function login() {}\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("updates changed file in existing map", async () => {
    const map = await scanRepo(dir, "lite");
    // Modify the file
    await writeFile(join(dir, "src", "auth.ts"),
      "export function login() {}\nexport function logout() {}\n");

    const updated = await refreshFiles(map, dir, ["src/auth.ts"]);
    const authFile = updated.modules.flatMap((m) => m.files).find((f) => f.p === "src/auth.ts");
    expect(authFile!.ex).toHaveLength(2);
    expect(authFile!.ex.some((e) => e.n === "logout")).toBe(true);
  });

  it("adds new file to existing module", async () => {
    const map = await scanRepo(dir, "lite");
    await writeFile(join(dir, "src", "rbac.ts"), "export function checkRole() {}\n");

    const updated = await refreshFiles(map, dir, ["src/rbac.ts"]);
    const allFiles = updated.modules.flatMap((m) => m.files);
    expect(allFiles.some((f) => f.p === "src/rbac.ts")).toBe(true);
  });

  it("updates scannedAt timestamp", async () => {
    const map = await scanRepo(dir, "lite");
    const updated = await refreshFiles(map, dir, ["src/auth.ts"]);
    expect(updated.scannedAt).not.toBe(map.scannedAt);
  });
});

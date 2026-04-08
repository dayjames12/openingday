import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensureGitignore } from "./gitignore.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("gitignore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "od-gitignore-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("creates .gitignore if missing", async () => {
    await ensureGitignore(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain(".openingday/*");
    expect(content).toContain("!.openingday/repo-map.json");
  });

  it("appends to existing .gitignore", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\ndist/\n");
    await ensureGitignore(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".openingday/*");
  });

  it("does not duplicate if already present", async () => {
    await writeFile(join(dir, ".gitignore"), ".openingday/*\n!.openingday/repo-map.json\n");
    await ensureGitignore(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    const matches = content.match(/\.openingday\/\*/g);
    expect(matches).toHaveLength(1);
  });
});

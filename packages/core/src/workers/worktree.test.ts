import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorktree, listWorktrees, removeWorktree } from "./worktree.js";

const exec = promisify(execFile);

describe("worktree", () => {
  let repoDir: string;
  const createdWorktrees: string[] = [];

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "od-wt-test-"));
    await exec("git", ["init", repoDir]);
    await exec("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
    await exec("git", ["config", "user.name", "Test"], { cwd: repoDir });
    await exec("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoDir });
    createdWorktrees.length = 0;
  });

  afterEach(async () => {
    // Remove any worktrees created during the test
    for (const wt of createdWorktrees) {
      try {
        await exec("git", ["worktree", "remove", "--force", wt], { cwd: repoDir });
      } catch {
        // Already removed or doesn't exist
      }
    }
    await rm(repoDir, { recursive: true, force: true });
  });

  it("createWorktree creates a worktree with correct path and branch", async () => {
    const result = await createWorktree(repoDir, "task-1");
    createdWorktrees.push(result.path);

    expect(result.path).toContain("task-1");
    expect(result.branch).toBe("openingday/task-1");
  });

  it("listWorktrees returns at least 2 entries after creating one", async () => {
    const wt = await createWorktree(repoDir, "task-2");
    createdWorktrees.push(wt.path);

    const list = await listWorktrees(repoDir);
    expect(list.length).toBeGreaterThanOrEqual(2);

    const branches = list.map((t) => t.branch);
    expect(branches).toContain("openingday/task-2");
  });

  it("removeWorktree removes the worktree from the list", async () => {
    const wt = await createWorktree(repoDir, "task-3");
    createdWorktrees.push(wt.path);

    await removeWorktree(repoDir, wt.path);

    const list = await listWorktrees(repoDir);
    const paths = list.map((t) => t.path);
    expect(paths).not.toContain(wt.path);

    // Remove from cleanup list since it's already gone
    const idx = createdWorktrees.indexOf(wt.path);
    if (idx >= 0) createdWorktrees.splice(idx, 1);
  });
});

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";

const exec = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export async function createWorktree(repoDir: string, taskId: string): Promise<WorktreeInfo> {
  const branch = `openingday/${taskId}`;
  const worktreePath = join(tmpdir(), `openingday-wt-${taskId}-${Date.now()}`);
  // Clean up stale branch from previous attempts
  try {
    await exec("git", ["branch", "-D", branch], { cwd: repoDir });
  } catch {
    /* branch didn't exist — fine */
  }
  await exec("git", ["worktree", "add", "-b", branch, worktreePath], { cwd: repoDir });
  return { path: worktreePath, branch };
}

export async function removeWorktree(repoDir: string, worktreePath: string): Promise<void> {
  await exec("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoDir });
}

export async function listWorktrees(repoDir: string): Promise<WorktreeInfo[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repoDir });
  const trees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length);
    else if (line.startsWith("branch refs/heads/"))
      current.branch = line.slice("branch refs/heads/".length);
    else if (line === "") {
      if (current.path) trees.push({ path: current.path, branch: current.branch ?? "HEAD" });
      current = {};
    }
  }
  return trees;
}

export async function mergeWorktree(
  repoDir: string,
  branch: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await exec("git", ["merge", branch, "--no-edit"], { cwd: repoDir });
    return { success: true };
  } catch (error: unknown) {
    const err = error as { stderr?: string };
    return { success: false, error: err.stderr ?? "merge failed" };
  }
}

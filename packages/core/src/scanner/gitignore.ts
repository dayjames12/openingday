import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const GITIGNORE_BLOCK = `
# OpeningDay
.openingday/*
!.openingday/repo-map.json
`;

export async function ensureGitignore(dir: string): Promise<void> {
  const gitignorePath = join(dir, ".gitignore");
  let content = "";

  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // File doesn't exist
  }

  if (content.includes(".openingday/*")) return;

  const updated = content.endsWith("\n") || content === ""
    ? content + GITIGNORE_BLOCK
    : content + "\n" + GITIGNORE_BLOCK;

  await writeFile(gitignorePath, updated, "utf-8");
}

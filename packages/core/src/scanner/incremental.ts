import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoMap, RepoFile } from "./types.js";
import { extractExports, extractImports } from "../seeder/from-repo.js";

export async function refreshFiles(
  map: RepoMap,
  repoDir: string,
  changedPaths: string[],
): Promise<RepoMap> {
  const updatedModules = [
    ...map.modules.map((m) => ({
      ...m,
      files: [...m.files],
    })),
  ];

  for (const relPath of changedPaths) {
    const fullPath = join(repoDir, relPath);
    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch {
      continue; // File deleted — skip (could remove from map in future)
    }

    const exports = extractExports(content);
    const imports = extractImports(content);
    const lines = content.split("\n").length;

    const newFile: RepoFile = {
      p: relPath,
      ex: exports.map((e) => ({ n: e.name, s: e.signature })),
      im: imports.map((i) => ({ f: i.from, n: i.names })),
      loc: lines,
    };

    // Find module for this file
    const parts = relPath.split("/");
    const modulePath = parts.length > 1 ? parts[0]! : ".";

    let moduleIdx = updatedModules.findIndex((m) => m.p === modulePath);
    if (moduleIdx === -1) {
      // New module
      updatedModules.push({
        p: modulePath,
        d: modulePath,
        fc: 0,
        k: [],
        files: [],
      });
      moduleIdx = updatedModules.length - 1;
    }

    const mod = updatedModules[moduleIdx]!;
    const fileIdx = mod.files.findIndex((f) => f.p === relPath);
    if (fileIdx >= 0) {
      mod.files[fileIdx] = newFile;
    } else {
      mod.files.push(newFile);
      mod.fc = mod.files.length;
    }

    // Update keywords
    const allExports = mod.files.flatMap((f) => f.ex.map((e) => e.n));
    mod.k = [...new Set(allExports)].slice(0, 10);
  }

  return {
    ...map,
    scannedAt: new Date().toISOString(),
    modules: updatedModules,
  };
}

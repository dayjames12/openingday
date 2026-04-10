import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RepoMap, RepoModule, RepoFile, ScanDepth, EnvConfig } from "./types.js";
import { detectEnv, detectDeps } from "./detect.js";
import { extractExports, extractImports } from "../seeder/from-repo.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".openingday",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  "build",
  "out",
  ".turbo",
  ".cache",
]);

export async function scanRepo(dir: string, depth: ScanDepth = "standard"): Promise<RepoMap> {
  // Env detection (standard + deep only)
  let env: EnvConfig = {
    pm: "npm",
    test: "none",
    lint: "none",
    ts: false,
    monorepo: false,
    workspaces: [],
    infra: "none",
  };
  let deps: string[] = [];

  if (depth !== "lite") {
    env = await detectEnv(dir);
    deps = await detectDeps(dir);
  }

  // Scan files
  const files: { path: string; content: string }[] = [];
  await walkDir(dir, dir, files);

  // Group into modules by top-level directory
  const moduleMap = new Map<string, RepoFile[]>();
  for (const file of files) {
    const relPath = relative(dir, file.path);
    const parts = relPath.split("/");
    const modulePath = parts.length > 1 ? parts[0]! : ".";

    const exports = extractExports(file.content);
    const imports = extractImports(file.content);
    const lines = file.content.split("\n").length;

    const repoFile: RepoFile = {
      p: relPath,
      ex: exports.map((e) => ({ n: e.name, s: e.signature })),
      im: imports.map((i) => ({ f: i.from, n: i.names })),
      loc: lines,
    };

    const existing = moduleMap.get(modulePath) ?? [];
    existing.push(repoFile);
    moduleMap.set(modulePath, existing);
  }

  // Build modules with keywords
  const modules: RepoModule[] = [];
  for (const [path, moduleFiles] of moduleMap) {
    const allExportNames = moduleFiles.flatMap((f) => f.ex.map((e) => e.n));
    const keywords = extractKeywords(allExportNames);

    modules.push({
      p: path,
      d: `${path}: ${keywords.slice(0, 5).join(", ")}`,
      fc: moduleFiles.length,
      k: keywords.slice(0, 10),
      files: moduleFiles,
    });
  }

  return {
    v: 1,
    scannedAt: new Date().toISOString(),
    depth,
    env,
    deps,
    modules,
  };
}

async function walkDir(
  baseDir: string,
  currentDir: string,
  results: { path: string; content: string }[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walkDir(baseDir, join(currentDir, entry.name), results);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      const fullPath = join(currentDir, entry.name);
      const content = await readFile(fullPath, "utf-8");
      results.push({ path: fullPath, content });
    }
  }
}

function extractKeywords(exportNames: string[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const name of exportNames) {
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      keywords.push(name);
    }
  }
  return keywords.sort((a, b) => b.length - a.length);
}

// Build landscape from RepoMap (compressed index for worker context)
export function buildLandscape(map: RepoMap): {
  mc: number;
  fc: number;
  modules: { p: string; fc: number; k: string[] }[];
} {
  return {
    mc: map.modules.length,
    fc: map.modules.reduce((sum, m) => sum + m.fc, 0),
    modules: map.modules.map((m) => ({ p: m.p, fc: m.fc, k: m.k.slice(0, 5) })),
  };
}

// Find relevant repo map files for a task's touches/reads
export function findRelevantFiles(map: RepoMap, touches: string[], reads: string[]): RepoFile[] {
  const targetPaths = new Set([...touches, ...reads]);
  const targetModules = new Set<string>();

  // Find modules that contain target files
  for (const mod of map.modules) {
    for (const file of mod.files) {
      if (targetPaths.has(file.p)) {
        targetModules.add(mod.p);
      }
    }
  }

  // Return all files in those modules (nearby context)
  const relevant: RepoFile[] = [];
  for (const mod of map.modules) {
    if (targetModules.has(mod.p)) {
      for (const file of mod.files) {
        if (!targetPaths.has(file.p)) {
          relevant.push(file);
        }
      }
    }
  }

  return relevant;
}

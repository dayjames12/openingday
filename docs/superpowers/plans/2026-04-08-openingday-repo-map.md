# OpeningDay Repo Map & Auto-Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, tiered repo map that gives workers landscape awareness, auto-detect project environment to eliminate manual setup, and integrate both into the seeder, context builder, orchestrator, and gates.

**Architecture:** New `scanner` module with tiered depth (lite/standard/deep). Produces `repo-map.json` alongside existing `code-tree.json`. Context builder merges both — workers see full landscape + relevant detail. Orchestrator does incremental refresh after each task merge. Auto-setup detects pm/test/lint/ts/monorepo/infra and writes gitignore rules.

**Tech Stack:** Existing OpeningDay core. No new deps for lite/standard tiers. Deep tier uses Agent SDK for AI summaries.

**Spec:** `docs/superpowers/specs/2026-04-08-openingday-repo-map-design.md`

---

## File Map

### `packages/core/src/` — New & Modified

| File | Responsibility |
|------|---------------|
| `src/scanner/types.ts` | Create — RepoMap, RepoModule, RepoFile, EnvConfig types (wire-mode field names) |
| `src/scanner/detect.ts` | Create — Auto-detect pm, test runner, linter, ts, monorepo, infra, deps |
| `src/scanner/scan.ts` | Create — Tiered scanner: lite/standard/deep. Builds RepoMap from filesystem |
| `src/scanner/deep.ts` | Create — AI summary generation for deep tier |
| `src/scanner/gitignore.ts` | Create — Auto-add .openingday rules to .gitignore |
| `src/scanner/incremental.ts` | Create — Partial rescan of changed files, merge into existing map |
| `src/context/context-builder.ts` | Modify — Add repoMap param, add landscape + relevant fields |
| `src/wire/wire.ts` | Modify — Add landscape + relevant to WirePrompt |
| `src/types.ts` | Modify — Add landscape/relevant to ContextPackage + WirePrompt |
| `src/orchestrator.ts` | Modify — Incremental map refresh after task merge |
| `src/seeder/from-spec.ts` | Modify — Accept repoMap for brownfield planning |
| `src/storage/interface.ts` | Modify — Add readRepoMap/writeRepoMap methods |
| `src/storage/disk.ts` | Modify — Implement repo map read/write |
| `src/index.ts` | Modify — Export scanner modules |

### `packages/cli/src/`

| File | Responsibility |
|------|---------------|
| `src/commands/scan.ts` | Create — `openingday scan` command |
| `src/commands/init.ts` | Modify — Add scan + auto-setup on init |
| `src/commands/new.ts` | Modify — Add scan tier selection + auto-setup |
| `src/index.ts` | Modify — Register scan command |

---

## Task 1: RepoMap Types

**Files:**
- Create: `packages/core/src/scanner/types.ts`
- Test: `packages/core/src/scanner/types.test.ts`

- [ ] **Step 1: Write type validation test**

```ts
// packages/core/src/scanner/types.test.ts
import { describe, it, expect } from "vitest";
import type { RepoMap, RepoModule, RepoFile, EnvConfig, ScanDepth } from "./types.js";

describe("scanner types", () => {
  it("creates a valid RepoMap", () => {
    const map: RepoMap = {
      v: 1,
      scannedAt: "2026-04-08T10:00:00Z",
      depth: "standard",
      env: {
        pm: "pnpm",
        test: "vitest",
        lint: "eslint",
        ts: true,
        monorepo: true,
        workspaces: ["packages/*"],
        infra: "sst",
      },
      deps: ["hono", "electrodb"],
      modules: [{
        p: "packages/core",
        d: "core logic",
        fc: 12,
        k: ["auth", "db"],
        files: [{
          p: "packages/core/src/auth.ts",
          ex: [{ n: "auth", s: "() => void" }],
          im: [{ f: "./types", n: ["User"] }],
          loc: 45,
        }],
      }],
    };
    expect(map.v).toBe(1);
    expect(map.env.pm).toBe("pnpm");
    expect(map.modules[0]!.files[0]!.ex[0]!.n).toBe("auth");
  });

  it("validates scan depth values", () => {
    const depths: ScanDepth[] = ["lite", "standard", "deep"];
    expect(depths).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/james.day/Development/openingday && pnpm test -- packages/core/src/scanner/types.test.ts`
Expected: FAIL

- [ ] **Step 3: Write types**

```ts
// packages/core/src/scanner/types.ts
// Wire-mode types for repo map. Field names abbreviated — only AI reads these.

export type ScanDepth = "lite" | "standard" | "deep";

export interface EnvConfig {
  pm: "pnpm" | "npm" | "yarn" | "bun";
  test: "vitest" | "jest" | "mocha" | "none";
  lint: "eslint" | "biome" | "none";
  ts: boolean;
  monorepo: boolean;
  workspaces: string[];
  infra: "sst" | "serverless" | "cdk" | "terraform" | "docker" | "none";
}

export interface RepoFile {
  p: string;           // path
  ex: RepoExport[];    // exports
  im: RepoImport[];    // imports
  loc: number;         // lines of code
}

export interface RepoExport {
  n: string;           // name
  s: string;           // signature
}

export interface RepoImport {
  f: string;           // from
  n: string[];         // names
}

export interface RepoModule {
  p: string;           // path
  d: string;           // description (wire-mode terse)
  fc: number;          // file count
  k: string[];         // keywords
  files: RepoFile[];
}

export interface RepoMap {
  v: number;           // version
  scannedAt: string;
  depth: ScanDepth;
  env: EnvConfig;
  deps: string[];
  modules: RepoModule[];
}

// Landscape = compressed index for worker context (~200 tokens)
export interface Landscape {
  mc: number;          // module count
  fc: number;          // total file count
  modules: { p: string; fc: number; k: string[] }[];
}

// For context builder: relevant files near the task
export interface RelevantFiles {
  files: RepoFile[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/scanner/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scanner/
git commit -m "feat: add wire-mode repo map types"
```

---

## Task 2: Environment Auto-Detection

**Files:**
- Create: `packages/core/src/scanner/detect.ts`
- Test: `packages/core/src/scanner/detect.test.ts`

- [ ] **Step 1: Write detection tests**

```ts
// packages/core/src/scanner/detect.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectEnv, detectDeps } from "./detect.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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
    await writeFile(join(dir, "package.json"), JSON.stringify({
      dependencies: { "hono": "^4.0.0", "electrodb": "^3.0.0" },
      devDependencies: { "vitest": "^4.0.0" },
    }));
    const deps = await detectDeps(dir);
    expect(deps).toContain("hono");
    expect(deps).toContain("electrodb");
    expect(deps).not.toContain("vitest"); // devDeps excluded from deps list
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/scanner/detect.test.ts`
Expected: FAIL

- [ ] **Step 3: Write detection implementation**

```ts
// packages/core/src/scanner/detect.ts
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { EnvConfig } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path: string): Promise<any> {
  try { return JSON.parse(await readFile(path, "utf-8")); } catch { return null; }
}

export async function detectEnv(dir: string): Promise<EnvConfig> {
  // Package manager
  let pm: EnvConfig["pm"] = "npm";
  if (await exists(join(dir, "pnpm-lock.yaml"))) pm = "pnpm";
  else if (await exists(join(dir, "yarn.lock"))) pm = "yarn";
  else if (await exists(join(dir, "bun.lock"))) pm = "bun";

  // Test runner
  let test: EnvConfig["test"] = "none";
  if (await exists(join(dir, "vitest.config.ts")) || await exists(join(dir, "vitest.config.js"))) test = "vitest";
  else if (await exists(join(dir, "jest.config.js")) || await exists(join(dir, "jest.config.ts"))) test = "jest";
  else if (await exists(join(dir, ".mocharc.yml")) || await exists(join(dir, ".mocharc.json"))) test = "mocha";
  else {
    const pkg = await readJson(join(dir, "package.json"));
    if (pkg?.devDependencies?.vitest || pkg?.dependencies?.vitest) test = "vitest";
    else if (pkg?.devDependencies?.jest || pkg?.dependencies?.jest) test = "jest";
  }

  // Linter
  let lint: EnvConfig["lint"] = "none";
  if (await exists(join(dir, "eslint.config.js")) || await exists(join(dir, "eslint.config.mjs")) || await exists(join(dir, ".eslintrc.json")) || await exists(join(dir, ".eslintrc.js"))) lint = "eslint";
  else if (await exists(join(dir, "biome.json")) || await exists(join(dir, "biome.jsonc"))) lint = "biome";

  // TypeScript
  const ts = await exists(join(dir, "tsconfig.json"));

  // Monorepo + workspaces
  let monorepo = false;
  let workspaces: string[] = [];

  const pnpmWorkspace = join(dir, "pnpm-workspace.yaml");
  if (await exists(pnpmWorkspace)) {
    monorepo = true;
    const content = await readFile(pnpmWorkspace, "utf-8");
    const match = content.match(/- ["']?([^"'\n]+)["']?/g);
    if (match) {
      workspaces = match.map((m) => m.replace(/^- ["']?/, "").replace(/["']?$/, ""));
    }
  } else {
    const pkg = await readJson(join(dir, "package.json"));
    if (pkg?.workspaces) {
      monorepo = true;
      workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages ?? [];
    }
  }
  if (await exists(join(dir, "turbo.json")) || await exists(join(dir, "lerna.json"))) monorepo = true;

  // Infrastructure
  let infra: EnvConfig["infra"] = "none";
  if (await exists(join(dir, "sst.config.ts")) || await exists(join(dir, "sst.config.js"))) infra = "sst";
  else if (await exists(join(dir, "serverless.yml")) || await exists(join(dir, "serverless.ts"))) infra = "serverless";
  else if (await exists(join(dir, "cdk.json"))) infra = "cdk";
  else if (await exists(join(dir, "terraform"))) infra = "terraform";
  else if (await exists(join(dir, "Dockerfile"))) infra = "docker";

  return { pm, test, lint, ts, monorepo, workspaces, infra };
}

export async function detectDeps(dir: string): Promise<string[]> {
  const deps: string[] = [];
  const pkg = await readJson(join(dir, "package.json"));
  if (pkg?.dependencies) {
    deps.push(...Object.keys(pkg.dependencies));
  }
  return deps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/scanner/detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scanner/detect.ts packages/core/src/scanner/detect.test.ts
git commit -m "feat: add environment auto-detection for pm, test, lint, ts, monorepo, infra"
```

---

## Task 3: Gitignore Auto-Setup

**Files:**
- Create: `packages/core/src/scanner/gitignore.ts`
- Test: `packages/core/src/scanner/gitignore.test.ts`

- [ ] **Step 1: Write gitignore test**

```ts
// packages/core/src/scanner/gitignore.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/scanner/gitignore.test.ts`
Expected: FAIL

- [ ] **Step 3: Write gitignore implementation**

```ts
// packages/core/src/scanner/gitignore.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/scanner/gitignore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scanner/gitignore.ts packages/core/src/scanner/gitignore.test.ts
git commit -m "feat: add auto-gitignore for .openingday with repo-map exception"
```

---

## Task 4: Tiered Repo Scanner

**Files:**
- Create: `packages/core/src/scanner/scan.ts`
- Test: `packages/core/src/scanner/scan.test.ts`

- [ ] **Step 1: Write scanner test**

```ts
// packages/core/src/scanner/scan.test.ts
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
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "test", dependencies: { hono: "^4.0.0" },
    }));
    await writeFile(join(dir, "tsconfig.json"), "{}");
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "auth.ts"),
      'export function login(user: string): boolean { return true; }\nexport interface User { id: string; }\n');
    await writeFile(join(dir, "src", "api.ts"),
      'import { login } from "./auth";\nexport function handler() { login("x"); }\n');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/scanner/scan.test.ts`
Expected: FAIL

- [ ] **Step 3: Write tiered scanner**

```ts
// packages/core/src/scanner/scan.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RepoMap, RepoModule, RepoFile, RepoExport, RepoImport, ScanDepth, EnvConfig } from "./types.js";
import { detectEnv, detectDeps } from "./detect.js";
import { extractExports, extractImports } from "../seeder/from-repo.js";

const IGNORED_DIRS = new Set([
  "node_modules", "dist", ".git", ".openingday", "coverage",
  ".next", ".nuxt", ".output", "build", "out", ".turbo", ".cache",
]);

export async function scanRepo(dir: string, depth: ScanDepth = "standard"): Promise<RepoMap> {
  // Env detection (standard + deep only)
  let env: EnvConfig = {
    pm: "npm", test: "none", lint: "none", ts: false,
    monorepo: false, workspaces: [], infra: "none",
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
  const entries = await readdir(currentDir, { withFileTypes: true });

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
  // Deduplicate and sort by frequency-like heuristic (longer names = more specific)
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
export function buildLandscape(map: RepoMap): { mc: number; fc: number; modules: { p: string; fc: number; k: string[] }[] } {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/scanner/scan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scanner/scan.ts packages/core/src/scanner/scan.test.ts
git commit -m "feat: add tiered repo scanner with landscape and relevant file extraction"
```

---

## Task 5: Incremental Map Refresh

**Files:**
- Create: `packages/core/src/scanner/incremental.ts`
- Test: `packages/core/src/scanner/incremental.test.ts`

- [ ] **Step 1: Write incremental test**

```ts
// packages/core/src/scanner/incremental.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/scanner/incremental.test.ts`
Expected: FAIL

- [ ] **Step 3: Write incremental refresh**

```ts
// packages/core/src/scanner/incremental.ts
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RepoMap, RepoFile } from "./types.js";
import { extractExports, extractImports } from "../seeder/from-repo.js";

export async function refreshFiles(
  map: RepoMap,
  repoDir: string,
  changedPaths: string[],
): Promise<RepoMap> {
  const updatedModules = [...map.modules.map((m) => ({
    ...m,
    files: [...m.files],
  }))];

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/scanner/incremental.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scanner/incremental.ts packages/core/src/scanner/incremental.test.ts
git commit -m "feat: add incremental repo map refresh for changed files"
```

---

## Task 6: Storage Layer — RepoMap Read/Write

**Files:**
- Modify: `packages/core/src/storage/interface.ts`
- Modify: `packages/core/src/storage/disk.ts`
- Modify: `packages/core/src/storage/disk.test.ts`

- [ ] **Step 1: Add test for repo map storage**

Add to existing `disk.test.ts`:

```ts
it("reads and writes repo map", async () => {
  const map = {
    v: 1, scannedAt: "2026-04-08T10:00:00Z", depth: "standard" as const,
    env: { pm: "pnpm" as const, test: "vitest" as const, lint: "eslint" as const, ts: true, monorepo: false, workspaces: [], infra: "none" as const },
    deps: ["hono"], modules: [],
  };
  await storage.writeRepoMap(map);
  const read = await storage.readRepoMap();
  expect(read).not.toBeNull();
  expect(read!.env.pm).toBe("pnpm");
});

it("returns null for missing repo map", async () => {
  const read = await storage.readRepoMap();
  expect(read).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/storage/disk.test.ts`
Expected: FAIL — readRepoMap/writeRepoMap don't exist

- [ ] **Step 3: Update storage interface and disk implementation**

Read both files. Add to `Storage` interface:
```ts
readRepoMap(): Promise<RepoMap | null>;
writeRepoMap(map: RepoMap): Promise<void>;
```

Add to `DiskStorage`:
```ts
async readRepoMap(): Promise<RepoMap | null> {
  try { return await this.readJson(this.path("repo-map.json")); }
  catch { return null; }
}
async writeRepoMap(map: RepoMap): Promise<void> {
  await this.writeJson(this.path("repo-map.json"), map);
}
```

Import `RepoMap` type from `../scanner/types.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/storage/disk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/
git commit -m "feat: add repo map read/write to storage layer"
```

---

## Task 7: Integrate Repo Map into Context Builder + Wire Mode + Types

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/context/context-builder.ts`
- Modify: `packages/core/src/wire/wire.ts`

- [ ] **Step 1: Update ContextPackage and WirePrompt types**

Read `packages/core/src/types.ts`. Add to `ContextPackage`:
```ts
landscape: { mc: number; fc: number; modules: { p: string; fc: number; k: string[] }[] };
relevant: { p: string; ex: { n: string; s: string }[]; im: { f: string; n: string[] }[]; loc: number }[];
```

Add to `WirePrompt`:
```ts
landscape: { mc: number; fc: number; modules: { p: string; fc: number; k: string[] }[] };
relevant: Record<string, { exports: { n: string; sig: string }[] }>;
```

- [ ] **Step 2: Update context builder**

Read `packages/core/src/context/context-builder.ts`. Add optional `repoMap` parameter:

```ts
import type { RepoMap } from "../scanner/types.js";
import { buildLandscape, findRelevantFiles } from "../scanner/scan.js";

export function buildContext(
  workTree: WorkTree,
  codeTree: CodeTree,
  config: ProjectConfig,
  taskId: string,
  memory: string,
  rules: string,
  repoMap?: RepoMap | null,
): ContextPackage | null
```

Inside the function, after existing above/below resolution:
```ts
const landscape = repoMap ? buildLandscape(repoMap) : { mc: 0, fc: 0, modules: [] };
const relevant = repoMap ? findRelevantFiles(repoMap, task.touches, task.reads) : [];
```

Include in returned ContextPackage.

- [ ] **Step 3: Update wire mode**

Read `packages/core/src/wire/wire.ts`. In `toWirePrompt`, add landscape and relevant:

```ts
return {
  ...existing fields,
  landscape: ctx.landscape,
  relevant: Object.fromEntries(
    ctx.relevant.map((f) => [f.p, { exports: f.ex.map((e) => ({ n: e.n, sig: e.s })) }])
  ),
};
```

- [ ] **Step 4: Update existing tests to pass with new optional param**

Existing `buildContext` calls pass 6 args. The new 7th param is optional, so existing tests should still compile. Run full suite to verify:

Run: `pnpm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/context/ packages/core/src/wire/
git commit -m "feat: integrate repo map into context builder and wire mode"
```

---

## Task 8: Integrate into Orchestrator + Seeder

**Files:**
- Modify: `packages/core/src/orchestrator.ts`
- Modify: `packages/core/src/seeder/from-spec.ts`

- [ ] **Step 1: Update orchestrator**

Read `packages/core/src/orchestrator.ts`. Changes:

1. In `runOneCycle`, read repo map from storage after reading codeTree:
```ts
const repoMap = await this.storage.readRepoMap();
```

2. Pass repoMap to buildContext:
```ts
const context = buildContext(workTree, codeTree, config, task.id, memory, "", repoMap);
```

3. After task passes gates and merges, do incremental refresh:
```ts
import { refreshFiles } from "./scanner/incremental.js";

// After applyWorkerResult:
if (repoMap && result.output.filesChanged.length > 0) {
  const updatedMap = await refreshFiles(repoMap, this.options.repoDir ?? ".", result.output.filesChanged);
  await this.storage.writeRepoMap(updatedMap);
}
```

- [ ] **Step 2: Update seeder**

Read `packages/core/src/seeder/from-spec.ts`. Add optional repoMap param to `seedFromSpec`:

```ts
export async function seedFromSpec(
  specText: string,
  projectName: string,
  cwd: string,
  budgetUsd?: number,
  repoMap?: RepoMap | null,
): Promise<SeederOutput | null>
```

In `buildSeederPrompt`, if repoMap provided, append compressed map summary to prompt:
```ts
export function buildSeederPrompt(specText: string, projectName: string, repoMap?: RepoMap | null): string {
  let prompt = /* existing prompt */;
  if (repoMap) {
    const landscape = buildLandscape(repoMap);
    prompt += `\n\nEXISTING CODEBASE:\n${JSON.stringify(landscape)}\n\nGenerate tasks that integrate with existing modules. Reuse existing patterns and utilities.`;
  }
  return prompt;
}
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All pass (seeder params optional, orchestrator repoMap read returns null if no map)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/orchestrator.ts packages/core/src/seeder/from-spec.ts
git commit -m "feat: orchestrator uses repo map for context + incremental refresh"
```

---

## Task 9: CLI — Scan Command + Update Init/New

**Files:**
- Create: `packages/cli/src/commands/scan.ts`
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/commands/new.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create scan command**

```ts
// packages/cli/src/commands/scan.ts
import { Command } from "commander";
import { DiskStorage } from "@openingday/core";
import { scanRepo } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";
import { join } from "node:path";
import chalk from "chalk";

export const scanCommand = new Command("scan")
  .description("Scan repo and update repo map")
  .option("--depth <depth>", "Scan depth: lite, standard, deep", "standard")
  .action(async (opts) => {
    const projectDir = process.cwd();
    const stateDir = join(projectDir, ".openingday");
    const storage = new DiskStorage(stateDir);

    console.log(chalk.yellow(`Scanning (${opts.depth})...`));
    const map = await scanRepo(projectDir, opts.depth);
    await storage.writeRepoMap(map);

    const totalFiles = map.modules.reduce((sum, m) => sum + m.fc, 0);
    console.log(chalk.green(`✓ ${map.modules.length} modules, ${totalFiles} files`));
    console.log(`  pm: ${map.env.pm} | test: ${map.env.test} | lint: ${map.env.lint} | ts: ${map.env.ts}`);
    if (map.env.monorepo) console.log(`  monorepo: ${map.env.workspaces.join(", ")}`);
    if (map.env.infra !== "none") console.log(`  infra: ${map.env.infra}`);
  });
```

- [ ] **Step 2: Update init command**

Read `packages/cli/src/commands/init.ts`. After storage initialization and before writing trees:

```ts
import { scanRepo } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";

// After storage.initialize():
await ensureGitignore(projectDir);

// If --from is a directory, scan it for repo map:
const isDir = /* check if opts.from is directory */;
if (isDir) {
  const repoMap = await scanRepo(fromPath, "standard");
  await storage.writeRepoMap(repoMap);
  // Pass repoMap to seedFromSpec if --spec provided
}
```

- [ ] **Step 3: Update new command**

Read `packages/cli/src/commands/new.ts`. After project creation:

```ts
import { scanRepo } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";

// After storage.initialize():
await ensureGitignore(process.cwd());

// Scan existing repo if there are files:
const repoMap = await scanRepo(process.cwd(), "standard");
await storage.writeRepoMap(repoMap);

// Pass repoMap to seedFromSpec:
const result = await seedFromSpec(specText, projectName, process.cwd(), undefined, repoMap);
```

- [ ] **Step 4: Register scan command**

Read `packages/cli/src/index.ts`, add `import { scanCommand }` and `program.addCommand(scanCommand)`.

- [ ] **Step 5: Build and verify**

Run: `pnpm build && node packages/cli/dist/index.js --help`
Expected: Shows `scan` command.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/
git commit -m "feat: add scan command, wire repo map into init and new"
```

---

## Task 10: Update Core Exports + Final Verification

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add scanner exports to barrel**

Read `packages/core/src/index.ts`. Add:

```ts
// Scanner
export { scanRepo, buildLandscape, findRelevantFiles } from "./scanner/scan.js";
export { detectEnv, detectDeps } from "./scanner/detect.js";
export { ensureGitignore } from "./scanner/gitignore.js";
export { refreshFiles } from "./scanner/incremental.js";
export type { RepoMap, RepoModule, RepoFile, RepoExport, RepoImport, EnvConfig, ScanDepth, Landscape, RelevantFiles } from "./scanner/types.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 4: Build + CLI**

Run: `pnpm build && node packages/cli/dist/index.js --help`
Expected: All 11 commands shown

- [ ] **Step 5: Update README multi-dev note**

Add to README.md under Requirements or as a new section:

```markdown
## Multi-Developer Usage

OpeningDay is designed for solo dev per branch. Multiple developers can use it on the same repo with different feature branches — coordinate via git, not OpeningDay. Multi-dev coordination is planned for a future release.
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts README.md
git commit -m "feat: export scanner modules, add multi-dev docs"
```

---

## What's NOT in This Plan (deferred)

- **Deep tier AI summaries** — `scanner/deep.ts` not built. Standard tier covers 90% of value. Add when needed.
- **AST-based parsing** — Regex scanner handles most TS patterns. AST (ts-morph) adds accuracy but heavy dep.
- **Gate env-aware command execution** — Gates currently check WorkerOutput, not run commands. When gates run real tsc/eslint, they'll use env config. Deferred until gates execute real commands.

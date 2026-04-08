import { access, readFile } from "node:fs/promises";
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

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
  p: string; // path
  ex: RepoExport[]; // exports
  im: RepoImport[]; // imports
  loc: number; // lines of code
}

export interface RepoExport {
  n: string; // name
  s: string; // signature
}

export interface RepoImport {
  f: string; // from
  n: string[]; // names
}

export interface RepoModule {
  p: string; // path
  d: string; // description (wire-mode terse)
  fc: number; // file count
  k: string[]; // keywords
  files: RepoFile[];
}

export interface PackageBuildConfig {
  tscCompatible: boolean;
  bundler?: "vite" | "webpack" | "esbuild" | "rollup";
  moduleResolution?: string;
}

export interface RepoMap {
  v: number; // version
  scannedAt: string;
  depth: ScanDepth;
  env: EnvConfig;
  deps: string[];
  modules: RepoModule[];
  packageConfigs?: Record<string, PackageBuildConfig>;
}

// Landscape = compressed index for worker context (~200 tokens)
export interface Landscape {
  mc: number; // module count
  fc: number; // total file count
  modules: { p: string; fc: number; k: string[] }[];
}

// For context builder: relevant files near the task
export interface RelevantFiles {
  files: RepoFile[];
}

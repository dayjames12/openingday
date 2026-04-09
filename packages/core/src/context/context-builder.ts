import type {
  WorkTree,
  WorkTask,
  CodeTree,
  CodeFile,
  ContextPackage,
  ProjectConfig,
  EnrichedContextPackage,
  TaskDigest,
} from "../types.js";
import type { RepoMap } from "../scanner/types.js";
import { getTask } from "../trees/work-tree.js";
import { getFile, getDependents, getDependencies } from "../trees/code-tree.js";
import { buildLandscape, findRelevantFiles } from "../scanner/scan.js";

/**
 * Build a ContextPackage for a given task, pulling in relevant code files,
 * dependencies, dependents, and budget constraints.
 */
export function buildContext(
  workTree: WorkTree,
  codeTree: CodeTree,
  config: ProjectConfig,
  taskId: string,
  memory: string,
  rules: string,
  repoMap?: RepoMap | null,
): ContextPackage | null {
  const task = getTask(workTree, taskId);
  if (!task) return null;

  // Resolve interface files (files this task touches)
  const interfaces = resolveFiles(codeTree, task.touches);

  // Resolve "above" files — files that the touched files import from
  const abovePaths = new Set<string>();
  for (const touchPath of task.touches) {
    for (const dep of getDependencies(codeTree, touchPath)) {
      if (!task.touches.includes(dep.path)) {
        abovePaths.add(dep.path);
      }
    }
  }
  // Also include explicit reads
  for (const readPath of task.reads) {
    if (!task.touches.includes(readPath)) {
      abovePaths.add(readPath);
    }
  }
  const above = resolveFiles(codeTree, Array.from(abovePaths));

  // Resolve "below" files — files that import from the touched files
  const belowPaths = new Set<string>();
  for (const touchPath of task.touches) {
    for (const dep of getDependents(codeTree, touchPath)) {
      if (!task.touches.includes(dep.path) && !abovePaths.has(dep.path)) {
        belowPaths.add(dep.path);
      }
    }
  }
  const below = resolveFiles(codeTree, Array.from(belowPaths));

  const perTaskBudget = config.budgets.perTask.usd;
  const softLimit = Math.floor(perTaskBudget * config.budgets.perTask.softPct / 100 * 1000);
  const hardLimit = perTaskBudget * 1000;

  const landscape = repoMap ? buildLandscape(repoMap) : { mc: 0, fc: 0, modules: [] };
  const relevant = repoMap ? findRelevantFiles(repoMap, task.touches, task.reads) : [];

  return {
    task: {
      name: task.name,
      description: task.description,
      acceptanceCriteria: buildAcceptanceCriteria(task),
    },
    interfaces,
    above,
    below,
    memory,
    rules,
    budget: {
      softLimit,
      hardLimit,
    },
    landscape,
    relevant,
  };
}

/**
 * Build an EnrichedContextPackage with full file contents, contracts, digests, and spec excerpt.
 * Falls back to regular context building, then layers on enriched fields.
 */
export function buildEnrichedContext(
  workTree: WorkTree,
  codeTree: CodeTree,
  config: ProjectConfig,
  taskId: string,
  memory: string,
  rules: string,
  repoMap?: RepoMap | null,
  contracts?: string,
  digests?: TaskDigest[],
  specExcerpt?: string,
  fileContents?: Record<string, string>,
): EnrichedContextPackage | null {
  const base = buildContext(workTree, codeTree, config, taskId, memory, rules, repoMap);
  if (!base) return null;

  return {
    ...base,
    fileContents: fileContents ?? {},
    contracts: contracts ?? "",
    digests: digests ?? [],
    specExcerpt: specExcerpt ?? "",
  };
}

function resolveFiles(codeTree: CodeTree, paths: string[]): CodeFile[] {
  return paths
    .map((p) => getFile(codeTree, p))
    .filter((f): f is CodeFile => f !== null);
}

function buildAcceptanceCriteria(task: WorkTask): string[] {
  const criteria: string[] = [];
  criteria.push(`Implement: ${task.name}`);
  if (task.touches.length > 0) {
    criteria.push(`Files to modify: ${task.touches.join(", ")}`);
  }
  if (task.reads.length > 0) {
    criteria.push(`Reference files: ${task.reads.join(", ")}`);
  }
  return criteria;
}

import type { SpringTrainingResult } from "../types.js";
import type { Storage } from "../storage/interface.js";
import type { RepoMap } from "../scanner/types.js";
import { validateStructure } from "./validate.js";
import { generateContracts } from "./contracts.js";
import { simulateExecution } from "./simulate.js";

/**
 * Run the full spring training pipeline: validate -> contracts -> simulate.
 * Returns a SpringTrainingResult for user review before execution.
 *
 * @param skipAI - When true, skips AI contract generation (for testing).
 */
export async function runSpringTraining(
  storage: Storage,
  specText: string,
  repoMap?: RepoMap | null,
  cwd?: string,
  skipAI?: boolean,
): Promise<SpringTrainingResult> {
  const workTree = await storage.readWorkTree();
  const codeTree = await storage.readCodeTree();

  // Phase A: Structural validation (no AI, instant)
  const validation = validateStructure(workTree, codeTree, repoMap);

  // If structural validation fails with blockers, return early
  // (but still populate the result fully)
  const blockers = [...validation.blockers];
  const warnings = [...validation.warnings];

  // Phase B: Contract generation (AI, one-time)
  let contracts = "";
  if (!skipAI) {
    contracts = await generateContracts(specText, repoMap, cwd);
    if (!contracts) {
      warnings.push("Contract generation returned empty result — workers will lack shared types");
    }
  }

  // Write contracts to storage regardless (empty string if skipped/failed)
  await storage.writeContracts(contracts);

  // Phase C: Execution simulation
  const simulation = simulateExecution(workTree, codeTree);
  warnings.push(...simulation.warnings);

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    contracts,
    executionOrder: simulation.executionOrder,
    addedDependencies: simulation.addedDependencies,
  };
}

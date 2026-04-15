import type { ProjectConfig } from "../types.js";

export function defaultConfig(name: string, specPath: string, model?: string): ProjectConfig {
  return {
    name,
    specPath,
    model,
    budgets: {
      project: { usd: 100, warnPct: 70 },
      perTask: { usd: 5, softPct: 75 },
      supervisor: { usd: 3 },
      planning: { usd: 5 },
    },
    limits: {
      maxConcurrentWorkers: 3,
      maxTotalWorkers: 50,
      maxRetries: 3,
      maxTaskDepth: 4,
      sessionTimeoutMin: 15,
      spawnRatePerMin: 5,
    },
    circuitBreakers: {
      consecutiveFailuresSlice: 3,
      consecutiveFailuresProject: 5,
      budgetEfficiencyThreshold: 0.5,
    },
  };
}

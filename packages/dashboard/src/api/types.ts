// === Dashboard API Types ===

export interface DashboardTask {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "complete" | "failed" | "paused";
  tokenSpend: number;
  attemptCount: number;
  worker: string | null;
}

export interface DashboardSlice {
  id: string;
  name: string;
  tasks: DashboardTask[];
}

export interface DashboardMilestone {
  id: string;
  name: string;
  slices: DashboardSlice[];
}

export interface DashboardWorker {
  id: string;
  taskId: string;
  taskName: string;
  status: "active" | "completed" | "failed" | "timed_out";
  startedAt: string;
  tokensUsed: number;
}

export interface DashboardGateEntry {
  taskId: string;
  taskName: string;
  layer: "automated" | "security" | "quality" | "tree-check" | "human";
  pass: boolean;
  issues: { severity: string; rule: string; file: string; note?: string }[];
  timestamp: string;
}

export interface DashboardCosts {
  totalSpentUsd: number;
  projectBudgetUsd: number;
  percentUsed: number;
  projectedTotalUsd: number;
  gatePassRate: number;
  spendByCategory: Record<string, number>;
}

export interface DashboardState {
  config: {
    name: string;
    maxConcurrentWorkers: number;
  };
  state: {
    status: string;
    totalTokenSpend: number;
    totalWorkersSpawned: number;
    startedAt: string;
    pausedAt: string | null;
  };
  workTree: DashboardMilestone[];
  workers: DashboardWorker[];
  gates: DashboardGateEntry[];
  costs: DashboardCosts;
}

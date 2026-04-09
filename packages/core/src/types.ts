// === Task Status ===

export type TaskStatus = "pending" | "in_progress" | "complete" | "failed" | "paused";

export type ProjectStatus = "idle" | "seeding" | "running" | "paused" | "complete" | "failed";

// === Work Tree ===

export interface WorkTask {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;
  dependencies: string[]; // task IDs
  touches: string[]; // code tree file paths (writes)
  reads: string[]; // code tree file paths (reads)
  worker: string | null; // session ID
  tokenSpend: number;
  attemptCount: number;
  gateResults: GateResult[];
  parentSliceId: string;
}

export interface WorkSlice {
  id: string;
  name: string;
  description: string;
  tasks: WorkTask[];
  parentMilestoneId: string;
}

export interface WorkMilestone {
  id: string;
  name: string;
  description: string;
  slices: WorkSlice[];
  dependencies: string[]; // milestone IDs
}

export interface WorkTree {
  milestones: WorkMilestone[];
}

// === Code Tree ===

export interface CodeExport {
  name: string;
  signature: string;
  description: string;
}

export interface CodeImport {
  from: string;
  names: string[];
}

export interface CodeFile {
  path: string;
  description: string;
  exports: CodeExport[];
  imports: CodeImport[];
  lastModifiedBy: string | null; // task ID
}

export interface CodeModule {
  path: string;
  description: string;
  files: CodeFile[];
}

export interface CodeTree {
  modules: CodeModule[];
}

// === Worker ===

export interface WorkerOutput {
  status: "complete" | "partial" | "failed";
  filesChanged: string[];
  interfacesModified: InterfaceChange[];
  testsAdded: string[];
  testResults: { pass: number; fail: number };
  notes: string;
  tokensUsed: number;
}

export interface InterfaceChange {
  file: string;
  export: string;
  before: string;
  after: string;
}

// === Context Package ===

export interface ContextPackage {
  task: { name: string; description: string; acceptanceCriteria: string[] };
  interfaces: CodeFile[];
  above: CodeFile[];
  below: CodeFile[];
  memory: string;
  rules: string;
  budget: { softLimit: number; hardLimit: number };
  landscape: { mc: number; fc: number; modules: { p: string; fc: number; k: string[] }[] };
  relevant: { p: string; ex: { n: string; s: string }[]; im: { f: string; n: string[] }[]; loc: number }[];
}

// === Wire Mode ===

export interface WirePrompt {
  task: string;
  files: Record<string, { exports: { n: string; sig: string }[] }>;
  reads: Record<string, { exports: { n: string; sig: string }[] }>;
  accept: string[];
  memory: string;
  budget: number;
  landscape: { mc: number; fc: number; modules: { p: string; fc: number; k: string[] }[] };
  relevant: Record<string, { exports: { n: string; sig: string }[] }>;
}

export interface WireResponse {
  s: "ok" | "partial" | "fail";
  changed: string[];
  iface: { f: string; e: string; b: string; a: string }[];
  tests: { p: number; f: number };
  t: number;
  n: string;
}

// === Gates ===

export type GateSeverity = "high" | "low";

export interface GateIssue {
  severity: GateSeverity;
  rule: string;
  file: string;
  line?: number;
  fix?: string;
  note?: string;
}

export interface GateResult {
  layer: "automated" | "security" | "quality" | "tree-check" | "verification" | "human";
  pass: boolean;
  issues: GateIssue[];
  timestamp: string;
}

// === Config ===

export interface BudgetConfig {
  project: { usd: number; warnPct: number };
  perTask: { usd: number; softPct: number };
  supervisor: { usd: number };
  planning: { usd: number };
}

export interface LimitsConfig {
  maxConcurrentWorkers: number;
  maxTotalWorkers: number;
  maxRetries: number;
  maxTaskDepth: number;
  sessionTimeoutMin: number;
  spawnRatePerMin: number;
}

export interface CircuitBreakerConfig {
  consecutiveFailuresSlice: number;
  consecutiveFailuresProject: number;
  budgetEfficiencyThreshold: number;
}

export interface ProjectConfig {
  name: string;
  specPath: string;
  budgets: BudgetConfig;
  limits: LimitsConfig;
  circuitBreakers: CircuitBreakerConfig;
}

// === Project State ===

export interface ProjectState {
  status: ProjectStatus;
  totalTokenSpend: number;
  totalWorkersSpawned: number;
  startedAt: string;
  pausedAt: string | null;
}

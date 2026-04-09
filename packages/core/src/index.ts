// @openingday/core entry point

// Types
export type {
  TaskStatus,
  ProjectStatus,
  WorkTask,
  WorkSlice,
  WorkMilestone,
  WorkTree,
  CodeExport,
  CodeImport,
  CodeFile,
  CodeModule,
  CodeTree,
  WorkerOutput,
  InterfaceChange,
  ContextPackage,
  WirePrompt,
  WireResponse,
  GateSeverity,
  GateIssue,
  GateResult,
  BudgetConfig,
  LimitsConfig,
  CircuitBreakerConfig,
  ProjectConfig,
  ProjectState,
  StageType,
  StageFeedback,
  StageResult,
  TaskDigest,
  SpringTrainingResult,
  EnrichedContextPackage,
  WatchdogState,
  LoopTracker,
} from "./types.js";

// Config
export { defaultConfig } from "./config/defaults.js";
export { loadStandards } from "./config/standards.js";

// Storage
export { DiskStorage } from "./storage/disk.js";
export type { Storage } from "./storage/interface.js";

// Work Tree
export {
  createWorkTree,
  addMilestone,
  addSlice,
  addTask,
  getAllTasks,
  getTasksInSlice,
  getTask,
  updateTaskStatus,
  updateTask,
  getReadyTasks,
  splitTask,
} from "./trees/work-tree.js";

// Code Tree
export {
  createCodeTree,
  addModule,
  addFile,
  getModule,
  getFile,
  getAllFiles,
  updateFile,
  setLastModifiedBy,
  getFileExports,
  getFileImports,
  getDependents,
  getDependencies,
} from "./trees/code-tree.js";

// Linker
export {
  resolveTaskTouches,
  resolveTaskReads,
  findTasksTouchingFile,
  findTasksReadingFile,
  detectFileConflicts,
  getActiveFileLocks,
  validateFileReferences,
} from "./trees/linker.js";

// Wire Mode
export { toWirePrompt, fromWireResponse, toWireResponse, toEnrichedWirePrompt } from "./wire/wire.js";

// Context Builder
export { buildContext, buildEnrichedContext } from "./context/context-builder.js";

// State Machine
export {
  createProjectState,
  canTransition,
  getValidTransitions,
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  isTerminal,
  isActive,
} from "./state/state-machine.js";

// Worker Pool
export {
  createWorkerPool,
  getActiveSessions,
  getSessionByTaskId,
  getActiveCount,
  planSpawns,
  spawnWorker,
  completeWorker,
  applyWorkerResult,
  findTimedOutSessions,
} from "./workers/pool.js";
export type { WorkerSession, WorkerPool, SpawnDecision } from "./workers/pool.js";

// Gates
export {
  runGatePipeline,
  automatedTestGate,
  treeCheckGate,
  securityGate,
  allGatesPassed,
  getHighSeverityIssues,
  countIssuesBySeverity,
  createDefaultPipeline,
} from "./gates/pipeline.js";
export type { GateLayer, GateCheck, VerificationGateCheck, AnyGateCheck } from "./gates/pipeline.js";

// Verification Gates
export {
  realTestGate,
  realDiffGate,
  realSecurityGate,
} from "./gates/verification.js";

// Budget
export {
  getProjectBudgetStatus,
  isTaskWithinBudget,
  isTaskAtSoftLimit,
  checkCircuitBreakers,
} from "./budget/budget.js";
export type { BudgetStatus, CircuitBreakerStatus } from "./budget/budget.js";

// Worktree
export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeWorktree,
} from "./workers/worktree.js";
export type { WorktreeInfo } from "./workers/worktree.js";

// Spawner
export {
  spawnAgent,
  buildSystemPrompt,
  buildUserPrompt,
  parseSpawnResult,
} from "./workers/spawner.js";
export type { SpawnOptions, SpawnResult } from "./workers/spawner.js";

// Worktree Inspection
export { inspectWorktreeOutput } from "./workers/inspect.js";

// Seeder (from spec)
export {
  seedFromSpec,
  buildSeederPrompt,
  parseSeederResponse,
} from "./seeder/from-spec.js";
export type { SeederOutput, SeederWarning } from "./seeder/from-spec.js";

// Seeder (from repo)
export { scanRepo } from "./seeder/from-repo.js";

// Scanner
export { scanRepo as scanRepoMap, buildLandscape, findRelevantFiles } from "./scanner/scan.js";
export { detectEnv, detectDeps } from "./scanner/detect.js";
export { ensureGitignore } from "./scanner/gitignore.js";
export { refreshFiles } from "./scanner/incremental.js";
export type { RepoMap, RepoModule, RepoFile, RepoExport, RepoImport, EnvConfig, ScanDepth, Landscape, RelevantFiles } from "./scanner/types.js";

// Estimator
export {
  estimateTaskContext,
  findOversizedTasks,
} from "./seeder/estimator.js";
export type { OversizedTask } from "./seeder/estimator.js";

// Supervisor
export {
  findStuckWorkers,
  findDeadTasks,
} from "./supervisor/health.js";
export {
  runSupervisorCheck,
} from "./supervisor/cron.js";
export type { SupervisorResult } from "./supervisor/cron.js";

// Quality Gate
export {
  runQualityReview,
  buildQualityPrompt,
  parseQualityResponse,
  createQualityGateCheck,
} from "./gates/quality.js";
export type { QualityReviewResult } from "./gates/quality.js";

// Preflight
export { preflightCheck } from "./preflight/check.js";
export type { PreflightResult } from "./preflight/check.js";

// Orchestrator
export { Orchestrator } from "./orchestrator.js";
export type { CycleResult, SpawnFn, OrchestratorOptions } from "./orchestrator.js";

// Spring Training
export { validateStructure } from "./spring-training/validate.js";
export type { ValidationResult } from "./spring-training/validate.js";
export { generateContracts, buildContractPrompt, parseContractResponse } from "./spring-training/contracts.js";
export { simulateExecution } from "./spring-training/simulate.js";
export type { SimulationResult } from "./spring-training/simulate.js";
export { runSpringTraining } from "./spring-training/runner.js";

// Stages
export { runCompileStage, runTsc } from "./stages/compile.js";
export type { TscResult } from "./stages/compile.js";
export { runTestStage, runTests } from "./stages/test.js";
export type { TestRunResult } from "./stages/test.js";
export { runReviewStage, buildReviewPrompt, parseReviewResponse } from "./stages/review.js";
export { digestCompileErrors, digestTestFailures, digestReviewIssues, parseFeedbackResponse } from "./stages/feedback.js";

// Digests
export { generateDigest } from "./digests/generator.js";

// Safety
export { createWatchdog, createWatchdogState } from "./safety/watchdog.js";
export type { WatchdogAction, Watchdog } from "./safety/watchdog.js";
export { createLoopTracker, recordLoop, shouldBreak } from "./safety/loops.js";
export type { BreakDecision } from "./safety/loops.js";

// Retry
export { withRetry, DEFAULT_RETRY } from "./utils/retry.js";
export type { RetryConfig } from "./utils/retry.js";

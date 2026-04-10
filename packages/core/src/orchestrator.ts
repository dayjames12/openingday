import type { Storage } from "./storage/interface.js";
import type {
  SpawnFn,
} from "./types.js";
import { refreshFiles } from "./scanner/incremental.js";
import {
  createWorkerPool,
  planSpawns,
  spawnWorker,
  completeWorker,
  applyWorkerResult,
  getActiveCount,
} from "./workers/pool.js";
import type { WorkerPool } from "./workers/pool.js";
import { buildEnrichedContext } from "./context/context-builder.js";
import {
  runGatePipeline,
  createDefaultPipeline,
} from "./gates/pipeline.js";
import { getAllTasks, getTask, updateTaskStatus, updateTask } from "./trees/work-tree.js";
import {
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  isTerminal,
} from "./state/state-machine.js";
import {
  getProjectBudgetStatus,
  checkCircuitBreakers,
} from "./budget/budget.js";
import {
  createWorktree,
  removeWorktree,
  mergeWorktree,
} from "./workers/worktree.js";
import { preflightCheck } from "./preflight/check.js";
import { generateDigest } from "./digests/generator.js";
import { createWatchdog, createWatchdogState } from "./safety/watchdog.js";
import type { Watchdog } from "./safety/watchdog.js";
import { getCachedContext, setCachedContext, invalidateContext } from "./cache/context-cache.js";
import { runSpringTraining } from "./spring-training/runner.js";
import { readFileContents } from "./pipeline/file-reader.js";
import { runStagedPipeline } from "./pipeline/stage-runner.js";

// === Types ===

export type { SpawnFn } from "./types.js";

export interface CycleResult {
  dispatched: number;
  completed: number;
  failed: number;
  isComplete: boolean;
  isPaused: boolean;
  error?: string;
}

// === Options ===

export interface OrchestratorOptions {
  repoDir?: string;
  specText?: string;
  skipSpringTraining?: boolean;
}

// === Orchestrator ===

export class Orchestrator {
  private pool: WorkerPool;
  private readonly options: OrchestratorOptions;
  private watchdog: Watchdog;
  private springTrainingDone = false;

  constructor(
    private readonly storage: Storage,
    private readonly spawn: SpawnFn,
    options?: OrchestratorOptions,
  ) {
    this.pool = createWorkerPool();
    this.options = options ?? {};
    this.watchdog = createWatchdog(createWatchdogState());
  }

  async runOneCycle(): Promise<CycleResult> {
    // 1. Read config, state, workTree, codeTree, memory from storage
    const config = await this.storage.readProjectConfig();
    let state = await this.storage.readProjectState();
    let workTree = await this.storage.readWorkTree();
    const codeTree = await this.storage.readCodeTree();
    const repoMap = await this.storage.readRepoMap();
    const memory = await this.storage.readMemory();

    // 2. Check if terminal/paused state
    if (isTerminal(state.status)) {
      return { dispatched: 0, completed: 0, failed: 0, isComplete: state.status === "complete", isPaused: false };
    }
    if (state.status === "paused") {
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true };
    }

    // 3. Watchdog check
    const watchdogAction = this.watchdog.check();
    if (watchdogAction === "pause") {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true, error: "Watchdog: no progress for 40 minutes" };
    }
    if (watchdogAction === "warn") {
      await this.storage.appendMemory("Watchdog warning: no task completed in 20 minutes");
    }

    // 4. Circuit breakers
    const circuitStatus = checkCircuitBreakers(workTree, state, config);
    if (circuitStatus.reason) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true, error: `Circuit breaker: ${circuitStatus.reason}` };
    }

    // 5. Budget check
    const budgetStatus = getProjectBudgetStatus(state, config);
    if (budgetStatus.atLimit) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: false, isPaused: true, error: "Budget limit reached" };
    }

    // 6. Spring training (once, before first dispatch)
    if (!this.springTrainingDone && !this.options.skipSpringTraining && this.options.specText) {
      try {
        const stResult = await runSpringTraining(this.storage, this.options.specText, repoMap, this.options.repoDir);
        if (!stResult.valid) {
          await this.storage.appendMemory(`Spring training blockers: ${stResult.blockers.join("; ")}`);
        }
        if (stResult.warnings.length > 0) {
          await this.storage.appendMemory(`Spring training warnings: ${stResult.warnings.join("; ")}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(`Spring training failed: ${msg}`);
      }
      this.springTrainingDone = true;
    }

    // 7. Auto-retry failed tasks under retry limit
    const retryCheck = getAllTasks(workTree);
    for (const task of retryCheck) {
      if (task.status === "failed" && task.attemptCount < config.limits.maxRetries) {
        workTree = updateTaskStatus(workTree, task.id, "pending");
      }
    }

    // 8. Plan spawns
    const spawnDecision = planSpawns(workTree, this.pool, config, state);

    // 9. Check completion
    const allTasks = getAllTasks(workTree);
    const allDone = allTasks.length === 0 || allTasks.every((t) => t.status === "complete" || t.status === "failed");
    const activeWorkers = getActiveCount(this.pool);

    if (allDone && activeWorkers === 0 && !spawnDecision.canSpawn) {
      state = transition(state, "complete");
      await this.storage.writeProjectState(state);
      return { dispatched: 0, completed: 0, failed: 0, isComplete: true, isPaused: false };
    }

    // 10. Dispatch tasks with staged pipeline
    let dispatched = 0;
    let completed = 0;
    let failed = 0;

    // Read shared context
    const contracts = await this.storage.readContracts();
    const digests = await this.storage.readDigests();
    const env = repoMap?.env ?? null;

    for (const task of spawnDecision.tasksToSpawn) {
      // Preflight
      const preflight = preflightCheck(workTree, codeTree, repoMap, config, task.id);
      if (!preflight.canProceed) {
        workTree = updateTaskStatus(workTree, task.id, "failed");
        failed++;
        await this.storage.appendMemory(`Task ${task.id} blocked by preflight: ${preflight.blockers.join("; ")}`);
        continue;
      }
      if (preflight.warnings.length > 0) {
        await this.storage.appendMemory(`Task ${task.id} preflight warnings: ${preflight.warnings.join("; ")}`);
      }

      // Build enriched context (check cache first for retry loops)
      let context = getCachedContext(task.id);
      if (!context) {
        const fileContents = await readFileContents(this.options.repoDir ?? ".", task.touches, task.reads);
        context = buildEnrichedContext(
          workTree, codeTree, config, task.id, memory, "",
          repoMap, contracts, digests, this.options.specText ?? "", fileContents,
        );
        if (!context) continue;
        setCachedContext(task.id, context);
      }

      // Create worktree
      let worktreePath = ".";
      let worktreeBranch: string | null = null;
      if (this.options.repoDir) {
        const wt = await createWorktree(this.options.repoDir, task.id);
        worktreePath = wt.path;
        worktreeBranch = wt.branch;
      }

      // Mark in_progress
      workTree = updateTaskStatus(workTree, task.id, "in_progress");
      const sessionId = `session-${task.id}-${Date.now()}`;
      this.pool = spawnWorker(this.pool, sessionId, task.id, worktreePath);
      state = incrementWorkersSpawned(state);
      dispatched++;

      try {
        // === STAGED PIPELINE (implement -> compile -> test -> review) ===
        const pipeline = await runStagedPipeline({
          taskId: task.id,
          taskTouches: task.touches,
          worktreePath,
          worktreeBranch,
          context,
          taskBudget: config.budgets.perTask.usd,
          env,
          repoDir: this.options.repoDir ?? null,
          spawn: this.spawn,
          contracts,
          specExcerpt: this.options.specText ?? "",
        });

        state = addTokenSpend(state, pipeline.workerOutput.tokensUsed);
        await this.storage.writeWorkerOutput(task.id, pipeline.workerOutput);

        for (const sr of pipeline.stageResults) {
          await this.storage.writeStageResult(task.id, sr);
        }

        let allStagesPassed = pipeline.allPassed;
        const workerOutput = pipeline.workerOutput;

        // === GATE PIPELINE (extra validation) ===
        if (allStagesPassed) {
          const pipeline = createDefaultPipeline(task.touches, undefined, {
            worktreePath: worktreePath !== "." ? worktreePath : undefined,
          });
          const gateResults = await runGatePipeline(
            pipeline,
            workerOutput,
            workTree,
            codeTree,
            worktreePath !== "." ? worktreePath : undefined,
          );

          for (const gr of gateResults.results) {
            await this.storage.writeGateResult(task.id, gr);
          }

          if (!gateResults.passed) {
            allStagesPassed = false;
          }
        }

        // === STAGE: MERGE ===
        if (allStagesPassed) {
          if (this.options.repoDir && worktreeBranch) {
            const mergeResult = await mergeWorktree(this.options.repoDir, worktreeBranch);
            if (!mergeResult.success) {
              workTree = updateTaskStatus(workTree, task.id, "failed");
              workTree = updateTask(workTree, task.id, { attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1 });
              this.pool = completeWorker(this.pool, sessionId, "failed");
              failed++;
              await this.storage.appendMemory(`Task ${task.id} merge conflict: ${mergeResult.error}`);
              continue;
            }
          }

          workTree = applyWorkerResult(workTree, task.id, workerOutput);
          this.pool = completeWorker(this.pool, sessionId, "completed");
          completed++;

          // Generate and store digest
          const digest = generateDigest(task.id, workerOutput, workTree, codeTree);
          await this.storage.writeDigest(task.id, digest);

          // Invalidate context cache for completed task
          invalidateContext(task.id);

          // Incremental repo map refresh
          if (repoMap && workerOutput.filesChanged.length > 0) {
            const updatedMap = await refreshFiles(repoMap, this.options.repoDir ?? ".", workerOutput.filesChanged);
            await this.storage.writeRepoMap(updatedMap);
          }

          // Reset watchdog on successful completion
          this.watchdog.reset();
        } else {
          workTree = updateTaskStatus(workTree, task.id, "failed");
          workTree = updateTask(workTree, task.id, { attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1 });
          this.pool = completeWorker(this.pool, sessionId, "failed");
          failed++;
          await this.storage.appendMemory(`Task ${task.id} failed staged pipeline at ${new Date().toISOString()}`);
        }
      } catch (err) {
        workTree = updateTaskStatus(workTree, task.id, "failed");
        workTree = updateTask(workTree, task.id, { attemptCount: (getTask(workTree, task.id)?.attemptCount ?? 0) + 1 });
        this.pool = completeWorker(this.pool, sessionId, "failed");
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(`Task ${task.id} spawn error: ${message}`);
      } finally {
        if (this.options.repoDir && worktreePath !== ".") {
          try { await removeWorktree(this.options.repoDir, worktreePath); } catch { /* cleanup non-fatal */ }
        }
      }
    }

    // Persist
    await this.storage.writeWorkTree(workTree);
    await this.storage.writeProjectState(state);

    return { dispatched, completed, failed, isComplete: false, isPaused: false };
  }

}

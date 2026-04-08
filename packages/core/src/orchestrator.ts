import type { Storage } from "./storage/interface.js";
import type { SpawnResult } from "./workers/spawner.js";
import type { ContextPackage } from "./types.js";
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
import { buildContext } from "./context/context-builder.js";
import {
  runGatePipeline,
  createDefaultPipeline,
} from "./gates/pipeline.js";
import { getAllTasks, updateTaskStatus } from "./trees/work-tree.js";
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

// === Types ===

export type SpawnFn = (options: {
  taskId: string;
  worktreePath: string;
  context: ContextPackage;
  budgetUsd: number;
}) => Promise<SpawnResult>;

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
}

// === Orchestrator ===

export class Orchestrator {
  private pool: WorkerPool;
  private readonly options: OrchestratorOptions;

  constructor(
    private readonly storage: Storage,
    private readonly spawn: SpawnFn,
    options?: OrchestratorOptions,
  ) {
    this.pool = createWorkerPool();
    this.options = options ?? {};
  }

  async runOneCycle(): Promise<CycleResult> {
    // 1. Read config, state, workTree, codeTree, memory from storage
    const config = await this.storage.readProjectConfig();
    let state = await this.storage.readProjectState();
    let workTree = await this.storage.readWorkTree();
    const codeTree = await this.storage.readCodeTree();
    const repoMap = await this.storage.readRepoMap();
    const memory = await this.storage.readMemory();

    // 2. Check if terminal/paused state → return early
    if (isTerminal(state.status)) {
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: state.status === "complete",
        isPaused: false,
      };
    }

    if (state.status === "paused") {
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: false,
        isPaused: true,
      };
    }

    // 3. Check circuit breakers → pause if tripped
    const circuitStatus = checkCircuitBreakers(workTree, state, config);
    if (circuitStatus.reason) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: false,
        isPaused: true,
        error: `Circuit breaker: ${circuitStatus.reason}`,
      };
    }

    // 4. Check budget → pause if over limit
    const budgetStatus = getProjectBudgetStatus(state, config);
    if (budgetStatus.atLimit) {
      state = transition(state, "paused");
      await this.storage.writeProjectState(state);
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: false,
        isPaused: true,
        error: "Budget limit reached",
      };
    }

    // 5. Call planSpawns() to find ready tasks
    const spawnDecision = planSpawns(workTree, this.pool, config, state);

    // 6. Check if all tasks done → transition to "complete"
    const allTasks = getAllTasks(workTree);
    const allDone =
      allTasks.length === 0 ||
      allTasks.every(
        (t) => t.status === "complete" || t.status === "failed",
      );
    const activeWorkers = getActiveCount(this.pool);

    if (allDone && activeWorkers === 0 && !spawnDecision.canSpawn) {
      state = transition(state, "complete");
      await this.storage.writeProjectState(state);
      return {
        dispatched: 0,
        completed: 0,
        failed: 0,
        isComplete: true,
        isPaused: false,
      };
    }

    // 7. For each task to spawn, dispatch and process
    let dispatched = 0;
    let completed = 0;
    let failed = 0;

    for (const task of spawnDecision.tasksToSpawn) {
      // a. Build context
      const context = buildContext(
        workTree,
        codeTree,
        config,
        task.id,
        memory,
        "", // rules
        repoMap,
      );
      if (!context) continue;

      // b. Resolve worktree path
      let worktreePath = ".";
      let worktreeBranch: string | null = null;
      if (this.options.repoDir) {
        const wt = await createWorktree(this.options.repoDir, task.id);
        worktreePath = wt.path;
        worktreeBranch = wt.branch;
      }

      // c. Mark task in_progress, register in pool
      workTree = updateTaskStatus(workTree, task.id, "in_progress");
      const sessionId = `session-${task.id}-${Date.now()}`;
      this.pool = spawnWorker(this.pool, sessionId, task.id, worktreePath);
      state = incrementWorkersSpawned(state);
      dispatched++;

      try {
        // d. Call spawn function
        const result = await this.spawn({
          taskId: task.id,
          worktreePath,
          context,
          budgetUsd: config.budgets.perTask.usd,
        });

        // e. Record token spend
        state = addTokenSpend(state, result.output.tokensUsed);

        // f. Store worker output
        await this.storage.writeWorkerOutput(task.id, result.output);

        // g. Run gate pipeline
        const pipeline = createDefaultPipeline(task.touches);
        const gateResults = runGatePipeline(
          pipeline,
          result.output,
          workTree,
          codeTree,
        );

        // h. Store gate results
        for (const gr of gateResults.results) {
          await this.storage.writeGateResult(task.id, gr);
        }

        // i. If passed: apply worker result, merge worktree, complete worker
        if (gateResults.passed) {
          if (this.options.repoDir && worktreeBranch) {
            await mergeWorktree(this.options.repoDir, worktreeBranch);
          }
          workTree = applyWorkerResult(workTree, task.id, result.output);
          this.pool = completeWorker(this.pool, sessionId, "completed");
          completed++;

          // Incremental repo map refresh
          if (repoMap && result.output.filesChanged.length > 0) {
            const updatedMap = await refreshFiles(repoMap, this.options.repoDir ?? ".", result.output.filesChanged);
            await this.storage.writeRepoMap(updatedMap);
          }
        } else {
          // j. If failed: mark failed, complete worker as failed, append to memory
          workTree = updateTaskStatus(workTree, task.id, "failed");
          this.pool = completeWorker(this.pool, sessionId, "failed");
          failed++;
          await this.storage.appendMemory(
            `Task ${task.id} failed gate checks at ${new Date().toISOString()}`,
          );
        }
      } catch (err) {
        // Spawn function threw — mark as failed
        workTree = updateTaskStatus(workTree, task.id, "failed");
        this.pool = completeWorker(this.pool, sessionId, "failed");
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await this.storage.appendMemory(
          `Task ${task.id} spawn error: ${message}`,
        );
      } finally {
        // k. Always cleanup worktree
        if (this.options.repoDir && worktreePath !== ".") {
          try {
            await removeWorktree(this.options.repoDir, worktreePath);
          } catch {
            // Cleanup failure is non-fatal
          }
        }
      }
    }

    // 8. Persist workTree and state
    await this.storage.writeWorkTree(workTree);
    await this.storage.writeProjectState(state);

    return {
      dispatched,
      completed,
      failed,
      isComplete: false,
      isPaused: false,
    };
  }
}

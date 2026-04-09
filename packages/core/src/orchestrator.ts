import type { Storage } from "./storage/interface.js";
import type { SpawnResult } from "./workers/spawner.js";
import type {
  ContextPackage,
  EnrichedContextPackage,
  StageResult,
  StageFeedback,
  LoopTracker,
} from "./types.js";
import type { EnvConfig } from "./scanner/types.js";
import { inspectWorktreeOutput } from "./workers/inspect.js";
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
import { runCompileStage } from "./stages/compile.js";
import { runTestStage } from "./stages/test.js";
import { runReviewStage } from "./stages/review.js";
import { generateDigest } from "./digests/generator.js";
import { createWatchdog, createWatchdogState } from "./safety/watchdog.js";
import type { Watchdog } from "./safety/watchdog.js";
import { createLoopTracker, recordLoop, shouldBreak } from "./safety/loops.js";
import { runSpringTraining } from "./spring-training/runner.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const exec = promisify(execFile);

// === Types ===

export type SpawnFn = (options: {
  taskId: string;
  worktreePath: string;
  context: ContextPackage | EnrichedContextPackage;
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

      // Build enriched context
      const fileContents = await this.readFileContents(task.touches, task.reads);
      const context = buildEnrichedContext(
        workTree, codeTree, config, task.id, memory, "",
        repoMap, contracts, digests, this.options.specText ?? "", fileContents,
      );
      if (!context) continue;

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
        // === STAGE: IMPLEMENT ===
        const result = await this.spawn({
          taskId: task.id,
          worktreePath,
          context,
          budgetUsd: config.budgets.perTask.usd,
        });

        let workerOutput = result.output;
        if (result.needsInspection && worktreePath !== ".") {
          workerOutput = await inspectWorktreeOutput(worktreePath, task.touches, env);
        }

        state = addTokenSpend(state, workerOutput.tokensUsed);
        await this.storage.writeWorkerOutput(task.id, workerOutput);

        // === STAGED FEEDBACK LOOPS ===
        let loopTracker = createLoopTracker(task.id);
        let allStagesPassed = true;

        // === STAGE: COMPILE ===
        if (env?.ts && worktreePath !== ".") {
          const compileResult = await this.runStageLoop(
            "compile",
            loopTracker,
            worktreePath,
            env,
            task.touches,
            config.budgets.perTask.usd,
            context,
            contracts,
            this.options.specText ?? "",
          );
          loopTracker = compileResult.tracker;
          await this.storage.writeStageResult(task.id, compileResult.result);
          if (!compileResult.result.passed) {
            allStagesPassed = false;
          }
        }

        // === STAGE: TEST ===
        if (allStagesPassed && env && worktreePath !== ".") {
          const testResult = await this.runStageLoop(
            "test",
            loopTracker,
            worktreePath,
            env,
            task.touches,
            config.budgets.perTask.usd,
            context,
            contracts,
            this.options.specText ?? "",
          );
          loopTracker = testResult.tracker;
          await this.storage.writeStageResult(task.id, testResult.result);
          if (!testResult.result.passed) {
            allStagesPassed = false;
          }
        }

        // === STAGE: REVIEW ===
        if (allStagesPassed && worktreePath !== ".") {
          let diff = "";
          try {
            const { stdout } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath });
            diff = stdout;
          } catch {
            diff = "(could not generate diff)";
          }

          const reviewResult = await runReviewStage(
            worktreePath,
            diff,
            contracts,
            this.options.specText ?? "",
            config.budgets.perTask.usd,
          );
          await this.storage.writeStageResult(task.id, reviewResult);
          if (!reviewResult.passed) {
            // Give worker one chance to fix review issues
            loopTracker = recordLoop(loopTracker, "review");
            const breakCheck = shouldBreak(loopTracker, "review", reviewResult.feedback, []);
            if (breakCheck.break) {
              allStagesPassed = false;
            } else {
              // Re-spawn with review feedback
              const feedbackContext = {
                ...context,
                memory: context.memory + `\nREVIEW FEEDBACK:\n${JSON.stringify(reviewResult.feedback)}`,
              };
              await this.spawn({
                taskId: task.id,
                worktreePath,
                context: feedbackContext,
                budgetUsd: config.budgets.perTask.usd / 4,
              });
              // Re-run review
              const retryReview = await runReviewStage(
                worktreePath, diff, contracts, this.options.specText ?? "",
                config.budgets.perTask.usd,
              );
              await this.storage.writeStageResult(task.id, retryReview);
              if (!retryReview.passed) {
                allStagesPassed = false;
              }
            }
          }
        }

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

  /**
   * Run a stage (compile or test) in a loop with AI feedback until passed or safety cap.
   */
  private async runStageLoop(
    stage: "compile" | "test",
    tracker: LoopTracker,
    worktreePath: string,
    env: EnvConfig,
    taskTouches: string[],
    taskBudget: number,
    context: EnrichedContextPackage,
    _contracts: string,
    _specExcerpt: string,
  ): Promise<{ result: StageResult; tracker: LoopTracker }> {
    const errorHistory: StageFeedback[] = [];
    const diffHistory: string[] = [];
    let totalLoops = 0;

    for (let i = 0; i < 5; i++) {
      // Run the stage
      let stageResult: StageResult;
      if (stage === "compile") {
        stageResult = await runCompileStage(worktreePath, taskBudget);
      } else {
        stageResult = await runTestStage(worktreePath, env, taskTouches, taskBudget);
      }

      if (stageResult.passed) {
        stageResult.loops = totalLoops;
        return { result: stageResult, tracker };
      }

      // Record loop
      tracker = recordLoop(tracker, stage);
      totalLoops++;

      // Collect feedback
      for (const fb of stageResult.feedback) {
        errorHistory.push(fb);
      }

      // Check safety caps
      const breakCheck = shouldBreak(tracker, stage, errorHistory, diffHistory);
      if (breakCheck.break) {
        stageResult.loops = totalLoops;
        return { result: stageResult, tracker };
      }

      // Re-spawn worker with feedback to fix issues
      const feedbackJson = JSON.stringify(stageResult.feedback);
      const feedbackContext: EnrichedContextPackage = {
        ...context,
        memory: context.memory + `\n${stage.toUpperCase()} FEEDBACK (loop ${totalLoops}):\n${feedbackJson}`,
      };

      await this.spawn({
        taskId: context.task.name,
        worktreePath,
        context: feedbackContext,
        budgetUsd: taskBudget / 4,
      });

      // Capture diff for stuck detection
      try {
        const { stdout } = await exec("git", ["diff"], { cwd: worktreePath });
        diffHistory.push(stdout);
      } catch {
        diffHistory.push("");
      }
    }

    // Fell through — max loops
    return {
      result: { stage, passed: false, loops: totalLoops, feedback: errorHistory },
      tracker,
    };
  }

  /**
   * Read actual file contents from disk for enriched context.
   * Large files (>300 lines): first 50 lines + exports + truncation notice.
   */
  private async readFileContents(touches: string[], reads: string[]): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};
    const basePath = this.options.repoDir ?? ".";
    const allPaths = [...new Set([...touches, ...reads])];

    for (const filePath of allPaths) {
      try {
        const fullPath = `${basePath}/${filePath}`;
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");

        if (lines.length > 300) {
          // Large file: first 50 lines + exports + truncation notice
          const first50 = lines.slice(0, 50).join("\n");
          const exportLines = lines
            .filter((l) => l.startsWith("export "))
            .join("\n");
          contents[filePath] = `${first50}\n\n// ... (${lines.length} lines total, truncated) ...\n\n// Exports:\n${exportLines}`;
        } else {
          contents[filePath] = content;
        }
      } catch {
        // File doesn't exist yet (new file) — skip
      }
    }

    return contents;
  }
}

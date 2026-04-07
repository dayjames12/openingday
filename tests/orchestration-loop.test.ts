/**
 * Integration test: exercises the full orchestration loop.
 *
 * seed trees -> dispatch workers -> execute (mock) -> gate review -> advance state
 *
 * This test walks through a complete cycle with two tasks (t1 and t2),
 * where t2 depends on t1, verifying that the scheduler, context builder,
 * wire format, gate pipeline, and budget tracking all work together.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Storage
import { DiskStorage } from "../packages/core/src/storage/disk.js";

// Config
import { defaultConfig } from "../packages/core/src/config/defaults.js";

// Work tree
import {
  createWorkTree,
  addMilestone,
  addSlice,
  addTask,
  getTask,
  getAllTasks,
  updateTaskStatus,
  getReadyTasks,
} from "../packages/core/src/trees/work-tree.js";

// Code tree
import {
  createCodeTree,
  addModule,
  addFile,
} from "../packages/core/src/trees/code-tree.js";

// Linker
import {
  getActiveFileLocks,
  detectFileConflicts,
} from "../packages/core/src/trees/linker.js";

// Wire mode
import { toWirePrompt, fromWireResponse } from "../packages/core/src/wire/wire.js";

// Context builder
import { buildContext } from "../packages/core/src/context/context-builder.js";

// State machine
import {
  createProjectState,
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  canTransition,
} from "../packages/core/src/state/state-machine.js";

// Worker pool
import {
  createWorkerPool,
  planSpawns,
  spawnWorker,
  completeWorker,
  applyWorkerResult,
} from "../packages/core/src/workers/pool.js";

// Gates
import {
  runGatePipeline,
  createDefaultPipeline,
} from "../packages/core/src/gates/pipeline.js";

// Budget
import {
  getProjectBudgetStatus,
  isTaskWithinBudget,
  checkCircuitBreakers,
} from "../packages/core/src/budget/budget.js";

import type { WireResponse } from "../packages/core/src/types.js";

describe("orchestration loop: seed -> dispatch -> execute -> gate -> advance", () => {
  let tmpDir: string;
  let storage: DiskStorage;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("completes a full orchestration cycle with dependency ordering", async () => {
    // ================================================================
    // SETUP: temp storage
    // ================================================================
    tmpDir = await mkdtemp(join(tmpdir(), "od-orch-loop-"));
    storage = new DiskStorage(tmpDir);
    await storage.initialize();

    const config = defaultConfig("orch-test", "spec.md");
    await storage.writeProjectConfig(config);

    // ================================================================
    // PHASE 1: SEED — Create work tree with 2 tasks (t2 depends on t1)
    //                  Create code tree with matching files.
    // ================================================================

    // Build code tree with two files in one module
    let codeTree = createCodeTree();
    codeTree = addModule(codeTree, {
      path: "src/services",
      description: "Application services",
    });
    codeTree = addFile(codeTree, "src/services", {
      path: "src/services/db.ts",
      description: "Database connection layer",
      exports: [
        { name: "createPool", signature: "() => Pool", description: "Create DB pool" },
        { name: "query", signature: "(sql: string) => Promise<Row[]>", description: "Run query" },
      ],
      imports: [],
    });
    codeTree = addFile(codeTree, "src/services", {
      path: "src/services/user-service.ts",
      description: "User CRUD service",
      exports: [
        { name: "UserService", signature: "class UserService", description: "User operations" },
      ],
      imports: [{ from: "src/services/db.ts", names: ["query"] }],
    });
    await storage.writeCodeTree(codeTree);

    // Build work tree: t1 (db layer) must finish before t2 (user service)
    let workTree = createWorkTree();
    workTree = addMilestone(workTree, {
      id: "ms-1",
      name: "Backend Services",
      description: "Core backend services",
      dependencies: [],
    });
    workTree = addSlice(workTree, "ms-1", {
      id: "sl-1",
      name: "Service Layer",
      description: "Data and user services",
    });
    workTree = addTask(workTree, "sl-1", {
      id: "t1",
      name: "Database layer",
      description: "Implement database connection pool and query helper",
      dependencies: [],
      touches: ["src/services/db.ts"],
      reads: [],
    });
    workTree = addTask(workTree, "sl-1", {
      id: "t2",
      name: "User service",
      description: "Implement user CRUD using the database layer",
      dependencies: ["t1"],
      touches: ["src/services/user-service.ts"],
      reads: ["src/services/db.ts"],
    });
    await storage.writeWorkTree(workTree);

    // Transition project: idle -> seeding -> running
    let state = createProjectState();
    expect(state.status).toBe("idle");
    state = transition(state, "seeding");
    state = transition(state, "running");
    expect(state.status).toBe("running");
    await storage.writeProjectState(state);

    // Verify seed: 2 tasks, both pending
    const seededTasks = getAllTasks(workTree);
    expect(seededTasks).toHaveLength(2);
    expect(seededTasks.every((t) => t.status === "pending")).toBe(true);

    // ================================================================
    // PHASE 2: DISPATCH — Find ready tasks. Only t1 should be ready
    //                      (t2 is blocked by its dependency on t1).
    // ================================================================

    let pool = createWorkerPool();

    const fileLocks = getActiveFileLocks(workTree);
    const readyTasksPhase2 = getReadyTasks(workTree, fileLocks);

    // Only t1 is ready; t2 is blocked
    expect(readyTasksPhase2).toHaveLength(1);
    expect(readyTasksPhase2[0]!.id).toBe("t1");

    // planSpawns should agree
    const spawnDecision = planSpawns(workTree, pool, config, state);
    expect(spawnDecision.canSpawn).toBe(true);
    expect(spawnDecision.tasksToSpawn).toHaveLength(1);
    expect(spawnDecision.tasksToSpawn[0]!.id).toBe("t1");

    // No file conflicts at this point
    const conflicts = detectFileConflicts(workTree);
    expect(conflicts.size).toBe(0);

    // Spawn worker for t1
    pool = spawnWorker(pool, "session-t1", "t1");
    state = incrementWorkersSpawned(state);
    workTree = updateTaskStatus(workTree, "t1", "in_progress");

    // ================================================================
    // PHASE 3: EXECUTE — Build context for t1, convert to wire format,
    //                     mock the execution, parse response.
    // ================================================================

    const ctx = buildContext(workTree, codeTree, config, "t1", "Project uses PostgreSQL", "Follow ESLint rules");
    expect(ctx).not.toBeNull();
    expect(ctx!.task.name).toBe("Database layer");
    expect(ctx!.task.description).toBe("Implement database connection pool and query helper");
    // interfaces should contain the file t1 touches
    expect(ctx!.interfaces).toHaveLength(1);
    expect(ctx!.interfaces[0]!.path).toBe("src/services/db.ts");
    // below should contain the user-service that imports from db.ts
    expect(ctx!.below).toHaveLength(1);
    expect(ctx!.below[0]!.path).toBe("src/services/user-service.ts");
    // above should be empty (db.ts has no imports)
    expect(ctx!.above).toHaveLength(0);
    // memory and rules should pass through
    expect(ctx!.memory).toBe("Project uses PostgreSQL");
    expect(ctx!.rules).toBe("Follow ESLint rules");
    // budget should be computed from config
    expect(ctx!.budget.hardLimit).toBeGreaterThan(0);
    expect(ctx!.budget.softLimit).toBeLessThanOrEqual(ctx!.budget.hardLimit);

    // Convert to wire prompt
    const wirePrompt = toWirePrompt(ctx!);
    expect(wirePrompt.task).toContain("Database layer");
    expect(wirePrompt.memory).toBe("Project uses PostgreSQL");
    expect(wirePrompt.budget).toBe(ctx!.budget.softLimit);
    expect(Object.keys(wirePrompt.files)).toContain("src/services/db.ts");

    // Simulate LLM execution: mock a successful wire response
    const mockWireResponse: WireResponse = {
      s: "ok",
      changed: ["src/services/db.ts"],
      iface: [
        {
          f: "src/services/db.ts",
          e: "createPool",
          b: "() => Pool",
          a: "(opts?: PoolOpts) => Pool",
        },
      ],
      tests: { p: 3, f: 0 },
      t: 1500,
      n: "Implemented createPool with connection pooling and query helper",
    };

    // Parse the wire response
    const workerOutput = fromWireResponse(mockWireResponse);
    expect(workerOutput.status).toBe("complete");
    expect(workerOutput.filesChanged).toEqual(["src/services/db.ts"]);
    expect(workerOutput.interfacesModified).toHaveLength(1);
    expect(workerOutput.interfacesModified[0]!.file).toBe("src/services/db.ts");
    expect(workerOutput.interfacesModified[0]!.export).toBe("createPool");
    expect(workerOutput.interfacesModified[0]!.before).toBe("() => Pool");
    expect(workerOutput.interfacesModified[0]!.after).toBe("(opts?: PoolOpts) => Pool");
    expect(workerOutput.testResults).toEqual({ pass: 3, fail: 0 });
    expect(workerOutput.tokensUsed).toBe(1500);

    // ================================================================
    // PHASE 4: GATE — Run gate pipeline with passing gates.
    // ================================================================

    const t1Task = getTask(workTree, "t1")!;
    const pipeline = createDefaultPipeline(t1Task.touches);
    const gateResult = runGatePipeline(pipeline, workerOutput, workTree, codeTree);

    expect(gateResult.passed).toBe(true);
    expect(gateResult.results).toHaveLength(3); // automated, tree-check, security
    expect(gateResult.results.every((r) => r.pass)).toBe(true);

    // Persist gate results
    for (const result of gateResult.results) {
      await storage.writeGateResult("t1", result);
    }
    await storage.writeWorkerOutput("t1", workerOutput);

    // ================================================================
    // PHASE 5: ADVANCE — Mark t1 complete. Verify t2 is now ready.
    // ================================================================

    // Apply worker result (marks task complete, records token spend)
    workTree = applyWorkerResult(workTree, "t1", workerOutput);
    state = addTokenSpend(state, workerOutput.tokensUsed);
    pool = completeWorker(pool, "session-t1", "completed");

    // Verify t1 is complete
    const t1After = getTask(workTree, "t1")!;
    expect(t1After.status).toBe("complete");
    expect(t1After.tokenSpend).toBe(1500);

    // Verify t2 is now unblocked and ready for dispatch
    const readyAfterAdvance = getReadyTasks(workTree, getActiveFileLocks(workTree));
    expect(readyAfterAdvance).toHaveLength(1);
    expect(readyAfterAdvance[0]!.id).toBe("t2");

    // planSpawns should now pick t2
    const spawnDecision2 = planSpawns(workTree, pool, config, state);
    expect(spawnDecision2.canSpawn).toBe(true);
    expect(spawnDecision2.tasksToSpawn).toHaveLength(1);
    expect(spawnDecision2.tasksToSpawn[0]!.id).toBe("t2");

    // Save progress
    await storage.writeWorkTree(workTree);
    await storage.writeProjectState(state);

    // ================================================================
    // PHASE 6: VERIFY — Check budget tracking, storage persistence,
    //                    state consistency.
    // ================================================================

    // Budget tracking
    const budgetStatus = getProjectBudgetStatus(state, config);
    expect(budgetStatus.totalSpent).toBe(1500);
    expect(budgetStatus.atLimit).toBe(false);
    expect(budgetStatus.atWarning).toBe(false);

    // Per-task budget check
    expect(isTaskWithinBudget(t1After, config)).toBe(true);

    // Circuit breakers should not have tripped (one success, no failures)
    const breakers = checkCircuitBreakers(workTree, state, config);
    expect(breakers.sliceTripped).toBe(false);
    expect(breakers.projectTripped).toBe(false);
    expect(breakers.efficiencyTripped).toBe(false);
    expect(breakers.reason).toBeNull();

    // State machine consistency
    expect(state.status).toBe("running");
    expect(state.totalWorkersSpawned).toBe(1);
    expect(state.totalTokenSpend).toBe(1500);
    expect(canTransition(state.status, "complete")).toBe(true);
    expect(canTransition(state.status, "paused")).toBe(true);

    // Storage persistence: reload from disk and verify
    const loadedWorkTree = await storage.readWorkTree();
    const loadedState = await storage.readProjectState();
    const loadedConfig = await storage.readProjectConfig();

    expect(getAllTasks(loadedWorkTree)).toHaveLength(2);
    expect(getTask(loadedWorkTree, "t1")!.status).toBe("complete");
    expect(getTask(loadedWorkTree, "t2")!.status).toBe("pending");

    expect(loadedState.totalTokenSpend).toBe(1500);
    expect(loadedState.totalWorkersSpawned).toBe(1);
    expect(loadedState.status).toBe("running");

    expect(loadedConfig.name).toBe("orch-test");

    // Worker output persistence
    const savedOutput = await storage.readWorkerOutput("t1");
    expect(savedOutput).not.toBeNull();
    expect(savedOutput!.status).toBe("complete");
    expect(savedOutput!.tokensUsed).toBe(1500);

    // Gate results persistence
    const savedGates = await storage.readGateResults("t1");
    expect(savedGates).toHaveLength(3);
    expect(savedGates.every((g) => g.pass)).toBe(true);

    // Memory persistence
    await storage.appendMemory("t1 changed createPool signature to accept PoolOpts");
    const memory = await storage.readMemory();
    expect(memory).toContain("createPool");
  });
});

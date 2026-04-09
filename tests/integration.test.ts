/**
 * Integration test: exercises the full OpeningDay workflow from project
 * initialization through task scheduling, worker execution, gate checking,
 * and project completion.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Storage
import { DiskStorage } from "../packages/core/src/storage/disk.js";

// Config
import { defaultConfig } from "../packages/core/src/config/defaults.js";

// Trees
import {
  createWorkTree,
  addMilestone,
  addSlice,
  addTask,
  getAllTasks,
  getTask,
  getReadyTasks,
  updateTaskStatus,
  splitTask,
} from "../packages/core/src/trees/work-tree.js";
import {
  createCodeTree,
  addModule,
  addFile,
  getFile,
  setLastModifiedBy,
} from "../packages/core/src/trees/code-tree.js";
import {
  resolveTaskTouches,
  getActiveFileLocks,
  validateFileReferences,
  detectFileConflicts,
} from "../packages/core/src/trees/linker.js";

// State machine
import {
  createProjectState,
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  isTerminal,
} from "../packages/core/src/state/state-machine.js";

// Wire mode
import { toWirePrompt, fromWireResponse, toWireResponse } from "../packages/core/src/wire/wire.js";

// Context builder
import { buildContext } from "../packages/core/src/context/context-builder.js";

// Workers
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
  allGatesPassed,
} from "../packages/core/src/gates/pipeline.js";

// Budget
import {
  getProjectBudgetStatus,
  checkCircuitBreakers,
} from "../packages/core/src/budget/budget.js";

import type { WorkTree, CodeTree, ProjectState, WireResponse } from "../packages/core/src/types.js";

describe("integration: full project lifecycle", () => {
  let tmpDir: string;
  let storage: DiskStorage;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "openingday-integ-"));
    storage = new DiskStorage(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs a complete project from init to completion", async () => {
    // === Step 1: Initialize project ===
    const config = defaultConfig("test-saas", "spec.md");
    await storage.writeProjectConfig(config);

    let state = createProjectState();
    state = transition(state, "seeding");
    await storage.writeProjectState(state);

    // === Step 2: Build code tree (project structure) ===
    let codeTree = createCodeTree();
    codeTree = addModule(codeTree, { path: "src/auth", description: "Authentication module" });
    codeTree = addFile(codeTree, "src/auth", {
      path: "src/auth/types.ts",
      description: "Auth type definitions",
      exports: [{ name: "AuthOpts", signature: "interface AuthOpts", description: "Auth config" }],
      imports: [],
    });
    codeTree = addFile(codeTree, "src/auth", {
      path: "src/auth/middleware.ts",
      description: "JWT middleware",
      exports: [{ name: "authMiddleware", signature: "(opts: AuthOpts) => Middleware", description: "JWT MW" }],
      imports: [{ from: "src/auth/types.ts", names: ["AuthOpts"] }],
    });
    codeTree = addFile(codeTree, "src/auth", {
      path: "src/auth/routes.ts",
      description: "Auth routes",
      exports: [{ name: "authRoutes", signature: "() => Router", description: "Routes" }],
      imports: [{ from: "src/auth/middleware.ts", names: ["authMiddleware"] }],
    });
    await storage.writeCodeTree(codeTree);

    // === Step 3: Build work tree (task plan) ===
    let workTree = createWorkTree();
    workTree = addMilestone(workTree, {
      id: "ms-auth",
      name: "Authentication",
      description: "Implement auth system",
      dependencies: [],
    });
    workTree = addSlice(workTree, "ms-auth", {
      id: "sl-jwt",
      name: "JWT Implementation",
      description: "JWT token handling",
    });
    workTree = addTask(workTree, "sl-jwt", {
      id: "task-types",
      name: "Auth types",
      description: "Define auth type interfaces",
      dependencies: [],
      touches: ["src/auth/types.ts"],
      reads: [],
    });
    workTree = addTask(workTree, "sl-jwt", {
      id: "task-middleware",
      name: "JWT middleware",
      description: "Implement JWT validation middleware",
      dependencies: ["task-types"],
      touches: ["src/auth/middleware.ts"],
      reads: ["src/auth/types.ts"],
    });
    workTree = addTask(workTree, "sl-jwt", {
      id: "task-routes",
      name: "Auth routes",
      description: "Implement auth API routes",
      dependencies: ["task-middleware"],
      touches: ["src/auth/routes.ts"],
      reads: ["src/auth/middleware.ts"],
    });
    await storage.writeWorkTree(workTree);

    // Validate all file references are valid
    const missingRefs = validateFileReferences(workTree, codeTree);
    expect(missingRefs).toHaveLength(0);

    // Transition to running
    state = transition(state, "running");
    await storage.writeProjectState(state);

    // === Step 4: Worker scheduling loop ===
    let pool = createWorkerPool();
    let tasksCompleted = 0;

    // Iteration 1: Only task-types is ready (no deps)
    {
      const fileLocks = getActiveFileLocks(workTree);
      const ready = getReadyTasks(workTree, fileLocks);
      expect(ready).toHaveLength(1);
      expect(ready[0]!.id).toBe("task-types");

      // Plan and spawn
      const decision = planSpawns(workTree, pool, config, state);
      expect(decision.canSpawn).toBe(true);
      expect(decision.tasksToSpawn).toHaveLength(1);

      // Spawn worker for task-types
      const taskId = "task-types";
      pool = spawnWorker(pool, "sess-1", taskId);
      state = incrementWorkersSpawned(state);
      workTree = updateTaskStatus(workTree, taskId, "in_progress");

      // Build context for the task
      const ctx = buildContext(workTree, codeTree, config, taskId, "", "strict mode");
      expect(ctx).not.toBeNull();
      expect(ctx!.task.name).toBe("Auth types");
      expect(ctx!.interfaces).toHaveLength(1);

      // Convert to wire format and simulate LLM response
      const wirePrompt = toWirePrompt(ctx!);
      expect(wirePrompt.task).toContain("Auth types");

      const wireResponse: WireResponse = {
        s: "ok",
        changed: ["src/auth/types.ts"],
        iface: [],
        tests: { p: 2, f: 0 },
        t: 3000,
        n: "Defined AuthOpts interface",
      };

      const workerOutput = fromWireResponse(wireResponse);
      expect(workerOutput.status).toBe("complete");

      // Run gate pipeline
      const pipeline = createDefaultPipeline(["src/auth/types.ts"]);
      const { results, passed } = await runGatePipeline(pipeline, workerOutput, workTree, codeTree);
      expect(passed).toBe(true);
      expect(allGatesPassed(results)).toBe(true);

      // Store gate results
      for (const result of results) {
        await storage.writeGateResult(taskId, result);
      }

      // Apply result
      workTree = applyWorkerResult(workTree, taskId, workerOutput);
      codeTree = setLastModifiedBy(codeTree, "src/auth/types.ts", taskId);
      state = addTokenSpend(state, workerOutput.tokensUsed);
      pool = completeWorker(pool, "sess-1", "completed");
      tasksCompleted++;

      // Verify task is complete
      expect(getTask(workTree, taskId)!.status).toBe("complete");
      expect(getFile(codeTree, "src/auth/types.ts")!.lastModifiedBy).toBe(taskId);

      await storage.writeWorkTree(workTree);
      await storage.writeCodeTree(codeTree);
      await storage.writeWorkerOutput(taskId, workerOutput);
    }

    // Iteration 2: task-middleware is now ready
    {
      const fileLocks = getActiveFileLocks(workTree);
      const ready = getReadyTasks(workTree, fileLocks);
      expect(ready).toHaveLength(1);
      expect(ready[0]!.id).toBe("task-middleware");

      const taskId = "task-middleware";
      pool = spawnWorker(pool, "sess-2", taskId);
      state = incrementWorkersSpawned(state);
      workTree = updateTaskStatus(workTree, taskId, "in_progress");

      // Simulate completion
      const workerOutput = fromWireResponse({
        s: "ok",
        changed: ["src/auth/middleware.ts"],
        iface: [{ f: "src/auth/middleware.ts", e: "authMiddleware", b: "() => void", a: "(opts: AuthOpts) => Middleware" }],
        tests: { p: 4, f: 0 },
        t: 5000,
        n: "Implemented JWT middleware",
      });

      const { passed } = await runGatePipeline(
        createDefaultPipeline(["src/auth/middleware.ts"]),
        workerOutput,
        workTree,
        codeTree,
      );
      expect(passed).toBe(true);

      workTree = applyWorkerResult(workTree, taskId, workerOutput);
      codeTree = setLastModifiedBy(codeTree, "src/auth/middleware.ts", taskId);
      state = addTokenSpend(state, workerOutput.tokensUsed);
      pool = completeWorker(pool, "sess-2", "completed");
      tasksCompleted++;

      await storage.writeWorkTree(workTree);
      await storage.writeWorkerOutput(taskId, workerOutput);
    }

    // Iteration 3: task-routes is now ready
    {
      const ready = getReadyTasks(workTree, getActiveFileLocks(workTree));
      expect(ready).toHaveLength(1);
      expect(ready[0]!.id).toBe("task-routes");

      const taskId = "task-routes";
      pool = spawnWorker(pool, "sess-3", taskId);
      state = incrementWorkersSpawned(state);
      workTree = updateTaskStatus(workTree, taskId, "in_progress");

      const workerOutput = fromWireResponse({
        s: "ok",
        changed: ["src/auth/routes.ts"],
        iface: [],
        tests: { p: 6, f: 0 },
        t: 4000,
        n: "Implemented auth routes",
      });

      const { passed } = await runGatePipeline(
        createDefaultPipeline(["src/auth/routes.ts"]),
        workerOutput,
        workTree,
        codeTree,
      );
      expect(passed).toBe(true);

      workTree = applyWorkerResult(workTree, taskId, workerOutput);
      state = addTokenSpend(state, workerOutput.tokensUsed);
      pool = completeWorker(pool, "sess-3", "completed");
      tasksCompleted++;

      await storage.writeWorkTree(workTree);
      await storage.writeWorkerOutput(taskId, workerOutput);
    }

    // === Step 5: Project completion ===
    const allTasks = getAllTasks(workTree);
    const allComplete = allTasks.every((t) => t.status === "complete");
    expect(allComplete).toBe(true);
    expect(tasksCompleted).toBe(3);

    state = transition(state, "complete");
    expect(isTerminal(state.status)).toBe(true);
    await storage.writeProjectState(state);

    // Verify final state
    const finalState = await storage.readProjectState();
    expect(finalState.status).toBe("complete");
    expect(finalState.totalWorkersSpawned).toBe(3);
    expect(finalState.totalTokenSpend).toBe(12000); // 3000 + 5000 + 4000

    // Verify budget status
    const budget = getProjectBudgetStatus(finalState, config);
    expect(budget.atLimit).toBe(false);

    // Verify no circuit breakers tripped
    const breakers = checkCircuitBreakers(workTree, finalState, config);
    expect(breakers.reason).toBeNull();

    // Verify storage roundtrips
    const savedWorkTree = await storage.readWorkTree();
    expect(getAllTasks(savedWorkTree)).toHaveLength(3);

    const workerIds = await storage.listWorkerOutputs();
    expect(workerIds.sort()).toEqual(["task-middleware", "task-routes", "task-types"]);
  });

  it("handles task splitting mid-project", async () => {
    const config = defaultConfig("test", "spec.md");
    await storage.writeProjectConfig(config);

    let workTree = createWorkTree();
    workTree = addMilestone(workTree, { id: "m1", name: "M1", description: "", dependencies: [] });
    workTree = addSlice(workTree, "m1", { id: "s1", name: "S1", description: "" });
    workTree = addTask(workTree, "s1", {
      id: "big-task",
      name: "Big task",
      description: "Does too much",
      dependencies: [],
      touches: ["a.ts", "b.ts", "c.ts"],
      reads: [],
    });
    workTree = addTask(workTree, "s1", {
      id: "after-task",
      name: "After task",
      description: "Depends on big task",
      dependencies: ["big-task"],
      touches: ["d.ts"],
      reads: [],
    });

    // Split the big task
    workTree = splitTask(workTree, "big-task", [
      { id: "sub-1", name: "Sub 1", description: "Part A", dependencies: [], touches: ["a.ts"], reads: [] },
      { id: "sub-2", name: "Sub 2", description: "Part B", dependencies: ["sub-1"], touches: ["b.ts"], reads: [] },
      { id: "sub-3", name: "Sub 3", description: "Part C", dependencies: ["sub-2"], touches: ["c.ts"], reads: [] },
    ]);

    // Verify split
    expect(getTask(workTree, "big-task")).toBeNull();
    expect(getAllTasks(workTree)).toHaveLength(4); // 3 subs + after-task

    // after-task should now depend on sub-3
    expect(getTask(workTree, "after-task")!.dependencies).toEqual(["sub-3"]);

    // Only sub-1 should be ready
    const ready = getReadyTasks(workTree, []);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.id).toBe("sub-1");

    // Complete sub-1 -> sub-2 becomes ready
    workTree = updateTaskStatus(workTree, "sub-1", "complete");
    expect(getReadyTasks(workTree, [])[0]!.id).toBe("sub-2");

    // Complete sub-2 -> sub-3 becomes ready
    workTree = updateTaskStatus(workTree, "sub-2", "complete");
    expect(getReadyTasks(workTree, [])[0]!.id).toBe("sub-3");

    // Complete sub-3 -> after-task becomes ready
    workTree = updateTaskStatus(workTree, "sub-3", "complete");
    expect(getReadyTasks(workTree, [])[0]!.id).toBe("after-task");
  });

  it("detects gate failures and handles retries", async () => {
    let workTree = createWorkTree();
    workTree = addMilestone(workTree, { id: "m1", name: "M1", description: "", dependencies: [] });
    workTree = addSlice(workTree, "m1", { id: "s1", name: "S1", description: "" });
    workTree = addTask(workTree, "s1", {
      id: "t1", name: "T1", description: "", dependencies: [], touches: ["a.ts"], reads: [],
    });

    const codeTree = createCodeTree();

    // Simulate worker changing an undeclared file
    const badOutput = fromWireResponse({
      s: "ok",
      changed: ["a.ts", "secret.ts"], // secret.ts not in touches
      iface: [],
      tests: { p: 1, f: 0 },
      t: 2000,
      n: "",
    });

    const pipeline = createDefaultPipeline(["a.ts"]);
    const { results, passed } = await runGatePipeline(pipeline, badOutput, workTree, codeTree);
    expect(passed).toBe(false);

    // Tree-check gate should have failed
    const treeCheck = results.find((r) => r.layer === "tree-check");
    expect(treeCheck).toBeDefined();
    expect(treeCheck!.pass).toBe(false);

    // Task stays failed, can be retried
    workTree = updateTaskStatus(workTree, "t1", "failed");
    expect(getTask(workTree, "t1")!.status).toBe("failed");

    // Reset to pending for retry
    workTree = updateTaskStatus(workTree, "t1", "pending");
    const ready = getReadyTasks(workTree, []);
    expect(ready).toHaveLength(1);
  });

  it("wire mode roundtrips correctly", () => {
    const wireResponse: WireResponse = {
      s: "ok",
      changed: ["a.ts", "b.ts"],
      iface: [{ f: "a.ts", e: "foo", b: "() => void", a: "() => string" }],
      tests: { p: 10, f: 0 },
      t: 25000,
      n: "Implemented feature",
    };

    const output = fromWireResponse(wireResponse);
    const back = toWireResponse(output);

    expect(back.s).toBe(wireResponse.s);
    expect(back.changed).toEqual(wireResponse.changed);
    expect(back.iface).toEqual(wireResponse.iface);
    expect(back.tests).toEqual(wireResponse.tests);
    expect(back.t).toBe(wireResponse.t);
    expect(back.n).toBe(wireResponse.n);
  });

  it("circuit breakers trip on repeated failures", async () => {
    const config = defaultConfig("test", "spec.md");
    let workTree = createWorkTree();
    workTree = addMilestone(workTree, { id: "m1", name: "M1", description: "", dependencies: [] });
    workTree = addSlice(workTree, "m1", { id: "s1", name: "S1", description: "" });

    // Create and fail 5 tasks (project circuit breaker threshold)
    for (let i = 1; i <= 5; i++) {
      workTree = addTask(workTree, "s1", {
        id: `t${i}`, name: `T${i}`, description: "",
        dependencies: [], touches: [], reads: [],
      });
      workTree = updateTaskStatus(workTree, `t${i}`, "failed");
    }

    const state = createProjectState();
    const breakers = checkCircuitBreakers(workTree, state, config);
    expect(breakers.projectTripped).toBe(true);
    expect(breakers.reason).not.toBeNull();
  });

  it("persists and retrieves full project state through storage", async () => {
    const config = defaultConfig("persist-test", "spec.md");
    await storage.writeProjectConfig(config);

    let state = createProjectState();
    state = transition(state, "seeding");
    state = transition(state, "running");
    state = addTokenSpend(state, 5000);
    state = incrementWorkersSpawned(state);
    await storage.writeProjectState(state);

    let workTree = createWorkTree();
    workTree = addMilestone(workTree, { id: "m1", name: "M1", description: "Test", dependencies: [] });
    workTree = addSlice(workTree, "m1", { id: "s1", name: "S1", description: "Test" });
    workTree = addTask(workTree, "s1", {
      id: "t1", name: "T1", description: "Test task",
      dependencies: [], touches: ["a.ts"], reads: [],
    });
    await storage.writeWorkTree(workTree);

    await storage.appendMemory("Decided to use JWT for auth");
    await storage.writeSupervisorLog("Started project");

    // Reload everything from storage
    const loadedConfig = await storage.readProjectConfig();
    const loadedState = await storage.readProjectState();
    const loadedTree = await storage.readWorkTree();
    const loadedMemory = await storage.readMemory();
    const loadedLogs = await storage.readSupervisorLogs();

    expect(loadedConfig.name).toBe("persist-test");
    expect(loadedState.status).toBe("running");
    expect(loadedState.totalTokenSpend).toBe(5000);
    expect(getAllTasks(loadedTree)).toHaveLength(1);
    expect(loadedMemory).toContain("JWT");
    expect(loadedLogs).toHaveLength(1);
  });
});

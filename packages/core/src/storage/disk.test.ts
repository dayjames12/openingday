import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiskStorage } from "./disk.js";
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
  GateResult,
} from "../types.js";

describe("DiskStorage", () => {
  let tmpDir: string;
  let storage: DiskStorage;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "openingday-test-"));
    storage = new DiskStorage(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- exists ---

  it("exists() returns true after initialize()", async () => {
    expect(await storage.exists()).toBe(true);
  });

  it("exists() returns false for uninitialized directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "openingday-empty-"));
    const emptyStorage = new DiskStorage(emptyDir);
    expect(await emptyStorage.exists()).toBe(false);
    await rm(emptyDir, { recursive: true, force: true });
  });

  // --- Project Config ---

  it("reads and writes project config roundtrip", async () => {
    const config: ProjectConfig = {
      name: "my-saas-app",
      specPath: "spec.md",
      budgets: {
        project: { usd: 50, warnPct: 70 },
        perTask: { usd: 2, softPct: 75 },
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

    await storage.writeProjectConfig(config);
    const read = await storage.readProjectConfig();
    expect(read).toEqual(config);
  });

  // --- Project State ---

  it("reads and writes project state roundtrip", async () => {
    const state: ProjectState = {
      status: "running",
      totalTokenSpend: 12400,
      totalWorkersSpawned: 8,
      startedAt: "2026-04-07T10:00:00Z",
      pausedAt: null,
    };

    await storage.writeProjectState(state);
    const read = await storage.readProjectState();
    expect(read).toEqual(state);
  });

  // --- Work Tree ---

  it("reads and writes work tree roundtrip", async () => {
    const tree: WorkTree = {
      milestones: [
        {
          id: "ms-1",
          name: "Auth System",
          description: "Implement authentication",
          dependencies: [],
          slices: [
            {
              id: "slice-1",
              name: "JWT Middleware",
              description: "JWT token validation",
              parentMilestoneId: "ms-1",
              tasks: [
                {
                  id: "task-1",
                  name: "Create JWT middleware",
                  description: "Implement JWT validation middleware",
                  status: "pending",
                  dependencies: [],
                  touches: ["src/auth/middleware.ts"],
                  reads: ["src/auth/types.ts"],
                  worker: null,
                  tokenSpend: 0,
                  attemptCount: 0,
                  gateResults: [],
                  parentSliceId: "slice-1",
                },
              ],
            },
          ],
        },
      ],
    };

    await storage.writeWorkTree(tree);
    const read = await storage.readWorkTree();
    expect(read).toEqual(tree);
  });

  // --- Code Tree ---

  it("reads and writes code tree roundtrip", async () => {
    const tree: CodeTree = {
      modules: [
        {
          path: "src/auth",
          description: "Authentication module",
          files: [
            {
              path: "src/auth/middleware.ts",
              description: "JWT authentication middleware",
              exports: [
                {
                  name: "authMiddleware",
                  signature: "(opts: AuthOpts) => Middleware",
                  description: "Creates JWT auth middleware",
                },
              ],
              imports: [
                { from: "src/auth/types", names: ["AuthOpts", "Middleware"] },
              ],
              lastModifiedBy: null,
            },
          ],
        },
      ],
    };

    await storage.writeCodeTree(tree);
    const read = await storage.readCodeTree();
    expect(read).toEqual(tree);
  });

  // --- Worker Output ---

  it("writes and reads worker output roundtrip", async () => {
    const output: WorkerOutput = {
      status: "complete",
      filesChanged: ["src/auth/middleware.ts"],
      interfacesModified: [
        {
          file: "src/auth/middleware.ts",
          export: "authMiddleware",
          before: "(req: Request) => void",
          after: "(req: Request, res: Response) => void",
        },
      ],
      testsAdded: ["src/auth/middleware.test.ts"],
      testResults: { pass: 5, fail: 0 },
      notes: "Added error handling for expired tokens",
      tokensUsed: 28000,
    };

    await storage.writeWorkerOutput("task-1", output);
    const read = await storage.readWorkerOutput("task-1");
    expect(read).toEqual(output);
  });

  it("returns null for missing worker output", async () => {
    const read = await storage.readWorkerOutput("nonexistent-task");
    expect(read).toBeNull();
  });

  // --- List Worker Outputs ---

  it("lists worker output IDs", async () => {
    const output: WorkerOutput = {
      status: "complete",
      filesChanged: ["src/a.ts"],
      interfacesModified: [],
      testsAdded: [],
      testResults: { pass: 1, fail: 0 },
      notes: "",
      tokensUsed: 5000,
    };

    await storage.writeWorkerOutput("task-a", output);
    await storage.writeWorkerOutput("task-b", { ...output, filesChanged: ["src/b.ts"] });
    await storage.writeWorkerOutput("task-c", { ...output, filesChanged: ["src/c.ts"] });

    const ids = await storage.listWorkerOutputs();
    expect(ids).toHaveLength(3);
    expect(ids.sort()).toEqual(["task-a", "task-b", "task-c"]);
  });

  // --- Gate Results ---

  it("writes and reads gate results", async () => {
    const result: GateResult = {
      layer: "automated",
      pass: true,
      issues: [],
      timestamp: "2026-04-07T10:30:00Z",
    };

    await storage.writeGateResult("task-1", result);
    const read = await storage.readGateResults("task-1");
    expect(read).toEqual([result]);
  });

  it("appends multiple gate results for same task", async () => {
    const automated: GateResult = {
      layer: "automated",
      pass: true,
      issues: [],
      timestamp: "2026-04-07T10:30:00Z",
    };

    const security: GateResult = {
      layer: "security",
      pass: false,
      issues: [
        {
          severity: "high",
          rule: "no-eval",
          file: "src/auth/middleware.ts",
          line: 42,
          fix: "Remove eval() call",
          note: "eval is a security risk",
        },
      ],
      timestamp: "2026-04-07T10:31:00Z",
    };

    const quality: GateResult = {
      layer: "quality",
      pass: true,
      issues: [
        {
          severity: "low",
          rule: "prefer-const",
          file: "src/auth/middleware.ts",
          line: 10,
        },
      ],
      timestamp: "2026-04-07T10:32:00Z",
    };

    await storage.writeGateResult("task-1", automated);
    await storage.writeGateResult("task-1", security);
    await storage.writeGateResult("task-1", quality);

    const read = await storage.readGateResults("task-1");
    expect(read).toHaveLength(3);
    expect(read[0]!.layer).toBe("automated");
    expect(read[1]!.layer).toBe("security");
    expect(read[2]!.layer).toBe("quality");
    expect(read[1]!.pass).toBe(false);
    expect(read[1]!.issues).toHaveLength(1);
    expect(read[1]!.issues[0]!.severity).toBe("high");
  });

  it("returns empty array for missing gate results", async () => {
    const read = await storage.readGateResults("nonexistent-task");
    expect(read).toEqual([]);
  });

  // --- Memory ---

  it("reads empty memory after initialize", async () => {
    const memory = await storage.readMemory();
    expect(memory).toBe("");
  });

  it("writes and reads memory", async () => {
    await storage.writeMemory("# Project Memory\n\nKey decisions go here.");
    const read = await storage.readMemory();
    expect(read).toBe("# Project Memory\n\nKey decisions go here.");
  });

  it("appends to memory", async () => {
    await storage.writeMemory("Line one");
    await storage.appendMemory("Line two");
    await storage.appendMemory("Line three");

    const read = await storage.readMemory();
    expect(read).toBe("Line one\nLine two\nLine three");
  });

  it("append to empty memory does not add leading newline", async () => {
    await storage.appendMemory("First entry");
    const read = await storage.readMemory();
    expect(read).toBe("First entry");
  });

  // --- Supervisor Logs ---

  it("writes and reads supervisor logs", async () => {
    await storage.writeSupervisorLog("Spawned worker for task-1");
    await storage.writeSupervisorLog("Worker task-1 completed");
    await storage.writeSupervisorLog("Gate check passed for task-1");

    const logs = await storage.readSupervisorLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0]).toBe("Spawned worker for task-1");
    expect(logs[1]).toBe("Worker task-1 completed");
    expect(logs[2]).toBe("Gate check passed for task-1");
  });

  it("returns empty array when no supervisor logs exist", async () => {
    const logs = await storage.readSupervisorLogs();
    expect(logs).toEqual([]);
  });
});

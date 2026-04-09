import { describe, it, expect, vi } from "vitest";
import { runSpringTraining } from "./runner.js";
import type { Storage } from "../storage/interface.js";
import type { WorkTree, CodeTree } from "../types.js";

function makeMinimalWorkTree(): WorkTree {
  return {
    milestones: [{
      id: "m1",
      name: "Build",
      description: "Build the thing",
      dependencies: [],
      slices: [{
        id: "m1-s1",
        name: "Core",
        description: "Core work",
        parentMilestoneId: "m1",
        tasks: [{
          id: "m1-s1-t1",
          name: "Create players route",
          description: "Create players route in src/routes/players.ts with GET/POST endpoints and tests",
          status: "pending",
          dependencies: [],
          touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
          reads: [],
          worker: null,
          tokenSpend: 0,
          attemptCount: 0,
          gateResults: [],
          parentSliceId: "m1-s1",
        }],
      }],
    }],
  };
}

function makeMinimalCodeTree(): CodeTree {
  return {
    modules: [{
      path: "src",
      description: "source",
      files: [
        { path: "src/routes/players.ts", description: "players route", exports: [], imports: [], lastModifiedBy: null },
        { path: "src/__tests__/players.test.ts", description: "players tests", exports: [], imports: [], lastModifiedBy: null },
      ],
    }],
  };
}

function makeMockStorage(workTree: WorkTree, codeTree: CodeTree): Storage {
  return {
    readProjectConfig: vi.fn().mockResolvedValue({
      name: "test",
      specPath: "spec.md",
      budgets: { project: { usd: 50, warnPct: 70 }, perTask: { usd: 2, softPct: 75 }, supervisor: { usd: 3 }, planning: { usd: 5 } },
      limits: { maxConcurrentWorkers: 3, maxTotalWorkers: 50, maxRetries: 3, maxTaskDepth: 4, sessionTimeoutMin: 15, spawnRatePerMin: 5 },
      circuitBreakers: { consecutiveFailuresSlice: 3, consecutiveFailuresProject: 5, budgetEfficiencyThreshold: 0.5 },
    }),
    writeProjectConfig: vi.fn().mockResolvedValue(undefined),
    readProjectState: vi.fn().mockResolvedValue({ status: "idle", totalTokenSpend: 0, totalWorkersSpawned: 0, startedAt: "", pausedAt: null }),
    writeProjectState: vi.fn().mockResolvedValue(undefined),
    readWorkTree: vi.fn().mockResolvedValue(workTree),
    writeWorkTree: vi.fn().mockResolvedValue(undefined),
    readCodeTree: vi.fn().mockResolvedValue(codeTree),
    writeCodeTree: vi.fn().mockResolvedValue(undefined),
    writeWorkerOutput: vi.fn().mockResolvedValue(undefined),
    readWorkerOutput: vi.fn().mockResolvedValue(null),
    listWorkerOutputs: vi.fn().mockResolvedValue([]),
    writeGateResult: vi.fn().mockResolvedValue(undefined),
    readGateResults: vi.fn().mockResolvedValue([]),
    readMemory: vi.fn().mockResolvedValue(""),
    writeMemory: vi.fn().mockResolvedValue(undefined),
    appendMemory: vi.fn().mockResolvedValue(undefined),
    writeSupervisorLog: vi.fn().mockResolvedValue(undefined),
    readSupervisorLogs: vi.fn().mockResolvedValue([]),
    readRepoMap: vi.fn().mockResolvedValue(null),
    writeRepoMap: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    writeDigest: vi.fn().mockResolvedValue(undefined),
    readDigests: vi.fn().mockResolvedValue([]),
    writeContracts: vi.fn().mockResolvedValue(undefined),
    readContracts: vi.fn().mockResolvedValue(""),
    writeStageResult: vi.fn().mockResolvedValue(undefined),
    readStageResults: vi.fn().mockResolvedValue([]),
  };
}

describe("runSpringTraining", () => {
  it("validates structure and returns result with valid flag", async () => {
    const wt = makeMinimalWorkTree();
    const ct = makeMinimalCodeTree();
    const storage = makeMockStorage(wt, ct);

    // Skip AI contract generation for unit test — test the orchestration flow
    const result = await runSpringTraining(storage, "Build a players API", undefined, process.cwd(), true);
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("blockers");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("executionOrder");
    expect(result).toHaveProperty("addedDependencies");
  });

  it("returns blockers when structure is invalid", async () => {
    const wt = makeMinimalWorkTree();
    // Empty code tree — all touch files will be missing
    const ct: CodeTree = { modules: [] };
    const storage = makeMockStorage(wt, ct);

    const result = await runSpringTraining(storage, "Build a players API", undefined, process.cwd(), true);
    expect(result.valid).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("writes contracts to storage when provided", async () => {
    const wt = makeMinimalWorkTree();
    const ct = makeMinimalCodeTree();
    const storage = makeMockStorage(wt, ct);

    await runSpringTraining(storage, "Build a players API", undefined, process.cwd(), true);
    // In skipAI mode, contracts are empty but writeContracts still called
    expect(storage.writeContracts).toHaveBeenCalled();
  });
});

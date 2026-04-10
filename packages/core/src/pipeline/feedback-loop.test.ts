import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StageResult, EnrichedContextPackage, SpawnFn } from "../types.js";
import { runFeedbackLoop } from "./feedback-loop.js";
import type { FeedbackLoopOptions } from "./feedback-loop.js";

// Mock the safety/loops module
vi.mock("../safety/loops.js", () => ({
  createLoopTracker: vi.fn((taskId: string) => ({
    taskId,
    stageLoopIds: [],
    totalLoops: 0,
  })),
  recordLoop: vi.fn((tracker: any, stage: string) => ({
    ...tracker,
    stageLoopIds: [...tracker.stageLoopIds, `${stage}-${tracker.totalLoops + 1}`],
    totalLoops: tracker.totalLoops + 1,
  })),
  shouldBreak: vi.fn(() => ({ break: false, reason: "" })),
}));

// Mock child_process for git diff
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: any) => {
    cb(null, { stdout: "mock-diff", stderr: "" });
  }),
}));

import { shouldBreak } from "../safety/loops.js";

const mockShouldBreak = vi.mocked(shouldBreak);

function makeContext(): EnrichedContextPackage {
  return {
    task: { name: "task-1", description: "test task", acceptanceCriteria: [] },
    interfaces: [],
    above: [],
    below: [],
    memory: "",
    rules: "",
    budget: { softLimit: 1, hardLimit: 2 },
    landscape: { mc: 0, fc: 0, modules: [] },
    relevant: [],
    fileContents: {},
    contracts: "",
    digests: [],
    specExcerpt: "",
  };
}

function makePassResult(stage: "compile" | "test" = "compile"): StageResult {
  return { stage, passed: true, loops: 0, feedback: [] };
}

function makeFailResult(stage: "compile" | "test" = "compile"): StageResult {
  return {
    stage,
    passed: false,
    loops: 0,
    feedback: [{ stage, errors: [{ f: "index.ts", l: 1, e: "error", fix: "fix it" }] }],
  };
}

describe("runFeedbackLoop", () => {
  let spawn: SpawnFn;
  let baseOptions: Omit<FeedbackLoopOptions, "runStage">;

  beforeEach(() => {
    vi.clearAllMocks();
    spawn = vi.fn().mockResolvedValue({ output: {}, costUsd: 0, sessionId: "s1" }) as unknown as SpawnFn;
    baseOptions = {
      stage: "compile",
      spawn,
      taskId: "task-1",
      worktreePath: "/tmp/wt",
      context: makeContext(),
      taskBudget: 1.0,
      maxIterations: 5,
    };
  });

  it("returns immediately when stage passes on first run", async () => {
    const runStage = vi.fn().mockResolvedValue(makePassResult());

    const result = await runFeedbackLoop({ ...baseOptions, runStage });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(0);
    expect(result.stuckDetected).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(runStage).toHaveBeenCalledTimes(1);
  });

  it("retries with feedback when stage fails then passes", async () => {
    const runStage = vi
      .fn()
      .mockResolvedValueOnce(makeFailResult())
      .mockResolvedValueOnce(makePassResult());

    const result = await runFeedbackLoop({ ...baseOptions, runStage });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(runStage).toHaveBeenCalledTimes(2);
    // Verify spawn was called with feedback appended to memory
    const spawnCall = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      context: EnrichedContextPackage;
    };
    expect(spawnCall.context.memory).toContain("COMPILE FEEDBACK");
  });

  it("stops at max iterations", async () => {
    const runStage = vi.fn().mockResolvedValue(makeFailResult());

    const result = await runFeedbackLoop({ ...baseOptions, maxIterations: 3, runStage });

    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(3);
    // Initial run + 3 retries = 4 total calls
    expect(runStage).toHaveBeenCalledTimes(4);
  });

  it("detects stuck loop via safety module", async () => {
    const runStage = vi.fn().mockResolvedValue(makeFailResult());
    // First call to shouldBreak returns no break, second returns stuck
    mockShouldBreak
      .mockReturnValueOnce({ break: false, reason: "" })
      .mockReturnValueOnce({ break: true, reason: "Same error repeated 3 times" });

    const result = await runFeedbackLoop({ ...baseOptions, runStage });

    expect(result.passed).toBe(false);
    expect(result.stuckDetected).toBe(true);
    expect(result.finalFeedback.length).toBeGreaterThan(0);
  });
});

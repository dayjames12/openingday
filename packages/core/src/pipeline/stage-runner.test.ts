import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnFn, EnrichedContextPackage, StageResult } from "../types.js";
import type { SpawnResult } from "../workers/spawner.js";
import type { EnvConfig } from "../scanner/types.js";
import { runStagedPipeline } from "./stage-runner.js";
import type { PipelineOptions } from "./stage-runner.js";

// Mock dependencies
vi.mock("../workers/inspect.js", () => ({
  inspectWorktreeOutput: vi.fn().mockResolvedValue({
    status: "complete",
    filesChanged: ["src/a.ts"],
    interfacesModified: [],
    testsAdded: [],
    testResults: { pass: 1, fail: 0 },
    notes: "inspected",
    tokensUsed: 100,
  }),
}));

vi.mock("../stages/compile.js", () => ({
  runCompileStage: vi.fn().mockResolvedValue({
    stage: "compile",
    passed: true,
    loops: 0,
    feedback: [],
  }),
}));

vi.mock("../stages/test.js", () => ({
  runTestStage: vi.fn().mockResolvedValue({
    stage: "test",
    passed: true,
    loops: 0,
    feedback: [],
  }),
}));

vi.mock("../stages/review.js", () => ({
  runReviewStage: vi.fn().mockResolvedValue({
    stage: "review",
    passed: true,
    loops: 0,
    feedback: [],
  }),
}));

vi.mock("./feedback-loop.js", () => ({
  runFeedbackLoop: vi.fn().mockResolvedValue({
    passed: true,
    iterations: 0,
    finalFeedback: [],
    stuckDetected: false,
    stageResult: { stage: "compile", passed: true, loops: 0, feedback: [] },
  }),
}));

vi.mock("../safety/loops.js", () => ({
  createLoopTracker: vi.fn((taskId: string) => ({
    taskId,
    stageLoopIds: [],
    totalLoops: 0,
  })),
  recordLoop: vi.fn((tracker: any, _stage: string) => ({
    ...tracker,
    totalLoops: tracker.totalLoops + 1,
  })),
  shouldBreak: vi.fn(() => ({ break: false, reason: "" })),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: any) => {
    cb(null, "mock-diff", "");
  }),
}));

import { inspectWorktreeOutput } from "../workers/inspect.js";
import { runReviewStage } from "../stages/review.js";
import { runFeedbackLoop } from "./feedback-loop.js";
import { shouldBreak } from "../safety/loops.js";

const mockInspect = vi.mocked(inspectWorktreeOutput);
const mockReview = vi.mocked(runReviewStage);
const mockFeedbackLoop = vi.mocked(runFeedbackLoop);
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

function makeSpawnResult(status: "complete" | "failed" = "complete"): SpawnResult {
  return {
    output: {
      status,
      filesChanged: status === "complete" ? ["src/a.ts"] : [],
      interfacesModified: [],
      testsAdded: [],
      testResults: { pass: 1, fail: 0 },
      notes: "done",
      tokensUsed: 100,
    },
    costUsd: 0.01,
    sessionId: "s1",
    needsInspection: false,
  };
}

function makeOptions(overrides?: Partial<PipelineOptions>): PipelineOptions {
  return {
    taskId: "task-1",
    taskTouches: ["src/a.ts"],
    worktreePath: "/tmp/wt",
    worktreeBranch: "feature/test",
    context: makeContext(),
    taskBudget: 1.0,
    env: null,
    repoDir: "/tmp/repo",
    spawn: vi.fn().mockResolvedValue(makeSpawnResult()) as unknown as SpawnFn,
    contracts: "contracts text",
    specExcerpt: "spec excerpt",
    ...overrides,
  };
}

describe("runStagedPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs implement stage and returns result when no env (only implement stage)", async () => {
    const opts = makeOptions({ env: null });

    const result = await runStagedPipeline(opts);

    expect(result.workerOutput.status).toBe("complete");
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]!.stage).toBe("implement");
    expect(result.stages[0]!.passed).toBe(true);
    expect(result.allPassed).toBe(true);
    expect(opts.spawn).toHaveBeenCalledOnce();
  });

  it("marks implement as failed when spawn returns failed output", async () => {
    const spawn = vi.fn().mockResolvedValue(makeSpawnResult("failed")) as unknown as SpawnFn;
    const opts = makeOptions({ spawn });

    const result = await runStagedPipeline(opts);

    expect(result.workerOutput.status).toBe("failed");
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]!.stage).toBe("implement");
    expect(result.stages[0]!.passed).toBe(false);
    expect(result.allPassed).toBe(false);
  });

  it("skips compile/test/review when worktreePath is '.'", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: true,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    const opts = makeOptions({ worktreePath: ".", env });

    const result = await runStagedPipeline(opts);

    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]!.stage).toBe("implement");
    expect(mockFeedbackLoop).not.toHaveBeenCalled();
    expect(mockReview).not.toHaveBeenCalled();
    expect(result.allPassed).toBe(true);
  });

  it("runs compile stage via feedback loop when env.ts is true", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: true,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    const opts = makeOptions({ env });

    const result = await runStagedPipeline(opts);

    expect(mockFeedbackLoop).toHaveBeenCalled();
    const firstCall = mockFeedbackLoop.mock.calls[0]![0];
    expect(firstCall.stage).toBe("compile");
    expect(result.allPassed).toBe(true);
  });

  it("runs test stage via feedback loop when env is present", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: false,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    const opts = makeOptions({ env });

    const result = await runStagedPipeline(opts);

    // ts=false so no compile, but test should run
    expect(mockFeedbackLoop).toHaveBeenCalledTimes(1);
    const call = mockFeedbackLoop.mock.calls[0]![0];
    expect(call.stage).toBe("test");
    expect(result.allPassed).toBe(true);
  });

  it("returns early when compile fails", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: true,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    mockFeedbackLoop.mockResolvedValueOnce({
      passed: false,
      iterations: 2,
      finalFeedback: [{ stage: "compile", errors: [{ f: "a.ts", l: 1, e: "err", fix: "fix" }] }],
      stuckDetected: false,
      stageResult: { stage: "compile", passed: false, loops: 2, feedback: [] },
    });

    const opts = makeOptions({ env });
    const result = await runStagedPipeline(opts);

    expect(result.allPassed).toBe(false);
    // Should not reach test or review
    expect(mockFeedbackLoop).toHaveBeenCalledTimes(1);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("runs review stage and passes", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: true,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    const opts = makeOptions({ env });

    const result = await runStagedPipeline(opts);

    expect(mockReview).toHaveBeenCalled();
    const reviewStage = result.stages.find((s) => s.stage === "review");
    expect(reviewStage).toBeDefined();
    expect(reviewStage!.passed).toBe(true);
    expect(result.allPassed).toBe(true);
  });

  it("retries review once on failure then passes", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: true,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    const failedReview: StageResult = {
      stage: "review",
      passed: false,
      loops: 0,
      feedback: [{ stage: "review", errors: [{ f: "a.ts", l: 1, e: "issue", fix: "fix" }] }],
    };
    const passedReview: StageResult = {
      stage: "review",
      passed: true,
      loops: 0,
      feedback: [],
    };
    mockReview.mockResolvedValueOnce(failedReview).mockResolvedValueOnce(passedReview);

    const opts = makeOptions({ env });
    const result = await runStagedPipeline(opts);

    expect(mockReview).toHaveBeenCalledTimes(2);
    // Spawn should be called for implement + review retry = 2 times
    expect(opts.spawn).toHaveBeenCalledTimes(2);
    const reviewStage = result.stages.find((s) => s.stage === "review");
    expect(reviewStage!.passed).toBe(true);
    expect(result.allPassed).toBe(true);
  });

  it("fails pipeline when review retry also fails and shouldBreak returns true", async () => {
    const env: EnvConfig = {
      pm: "pnpm",
      test: "vitest",
      lint: "eslint",
      ts: true,
      monorepo: false,
      workspaces: [],
      infra: "none",
    };
    const failedReview: StageResult = {
      stage: "review",
      passed: false,
      loops: 0,
      feedback: [{ stage: "review", errors: [{ f: "a.ts", l: 1, e: "issue", fix: "fix" }] }],
    };
    mockReview.mockResolvedValue(failedReview);
    mockShouldBreak.mockReturnValueOnce({ break: true, reason: "Max loops" });

    const opts = makeOptions({ env });
    const result = await runStagedPipeline(opts);

    expect(result.allPassed).toBe(false);
    // shouldBreak returned true, so no retry spawn
    expect(opts.spawn).toHaveBeenCalledTimes(1); // only implement
  });

  it("uses inspectWorktreeOutput when needsInspection is true and worktreePath is not '.'", async () => {
    const spawnResult = makeSpawnResult("complete");
    spawnResult.needsInspection = true;
    const spawn = vi.fn().mockResolvedValue(spawnResult) as unknown as SpawnFn;

    const opts = makeOptions({ spawn });
    const result = await runStagedPipeline(opts);

    expect(mockInspect).toHaveBeenCalledWith("/tmp/wt", ["src/a.ts"], null);
    expect(result.workerOutput.status).toBe("complete");
  });
});

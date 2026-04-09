// packages/core/src/stages/compile.test.ts
import { describe, it, expect, vi } from "vitest";
import { runTsc } from "./compile.js";
import type { StageResult } from "../types.js";

vi.mock("node:child_process", () => {
  const execFileFn = vi.fn();
  return {
    execFile: execFileFn,
  };
});

describe("runCompileStage", () => {
  it("returns passed when tsc succeeds", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string, stderr: string) => void)(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTsc("/tmp/test-worktree");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("");
  });

  it("returns error output when tsc fails", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      const error = new Error("tsc failed") as Error & { code: number; stdout: string; stderr: string };
      error.code = 1;
      error.stdout = "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.";
      error.stderr = "";
      (cb as (err: typeof error) => void)(error);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTsc("/tmp/test-worktree");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("TS2322");
  });
});

describe("compile StageResult shape", () => {
  it("produces valid StageResult", () => {
    const result: StageResult = {
      stage: "compile",
      passed: true,
      loops: 1,
      feedback: [],
    };
    expect(result.stage).toBe("compile");
    expect(result.passed).toBe(true);
  });
});

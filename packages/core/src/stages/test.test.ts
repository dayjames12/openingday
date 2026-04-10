// packages/core/src/stages/test.test.ts
import { describe, it, expect, vi } from "vitest";
import { runTests } from "./test.js";
import type { StageResult } from "../types.js";
import type { EnvConfig } from "../scanner/types.js";

vi.mock("node:child_process", () => {
  const execFileFn = vi.fn();
  return {
    execFile: execFileFn,
  };
});

const defaultEnv: EnvConfig = {
  pm: "pnpm",
  test: "vitest",
  lint: "eslint",
  ts: true,
  monorepo: false,
  workspaces: [],
  infra: "none",
};

describe("runTests", () => {
  it("returns passed when tests succeed", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string, stderr: string) => void)(
        null,
        "Tests passed\n 5 passed",
        "",
      );
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTests("/tmp/test-worktree", defaultEnv);
    expect(result.exitCode).toBe(0);
  });

  it("returns error output when tests fail", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = vi.mocked(execFile);
    mockExec.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      const error = new Error("tests failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout = "FAIL src/__tests__/players.test.ts\n  Expected 200, received 404";
      error.stderr = "";
      (cb as (err: typeof error) => void)(error);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await runTests("/tmp/test-worktree", defaultEnv);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("FAIL");
  });
});

describe("test StageResult shape", () => {
  it("produces valid StageResult for no-tests case", () => {
    const result: StageResult = {
      stage: "test",
      passed: false,
      loops: 0,
      feedback: [
        {
          stage: "test",
          errors: [
            {
              f: "src/routes/players.ts",
              l: 0,
              e: "No tests found",
              fix: "Write tests for this module",
            },
          ],
        },
      ],
    };
    expect(result.feedback[0]!.errors[0]!.e).toContain("No tests");
  });
});

import { describe, it, expect } from "vitest";
import { classifyFailure } from "./classify.js";
import type { StageResult } from "../types.js";

function makeStageResult(overrides: Partial<StageResult> & { stage: StageResult["stage"] }): StageResult {
  return {
    passed: false,
    loops: 1,
    feedback: [],
    ...overrides,
  };
}

describe("classifyFailure", () => {
  describe("infra failures", () => {
    it("classifies Cannot find module in untouched file as infra", () => {
      const results: StageResult[] = [
        makeStageResult({
          stage: "compile",
          passed: false,
          feedback: [
            {
              stage: "compile",
              errors: [
                { f: "src/index.ts", l: 1, e: "Cannot find module '@openingday/core'", fix: "" },
              ],
            },
          ],
        }),
      ];

      const result = classifyFailure(results);
      expect(result.kind).toBe("infra");
      expect(result.stage).toBe("compile");
    });

    it("classifies composite: true tsconfig error as infra", () => {
      const results: StageResult[] = [
        makeStageResult({
          stage: "compile",
          passed: false,
          feedback: [
            {
              stage: "compile",
              errors: [
                {
                  f: "tsconfig.json",
                  l: 0,
                  e: 'Referenced project must have setting "composite": true',
                  fix: "",
                },
              ],
            },
          ],
        }),
      ];

      const result = classifyFailure(results);
      expect(result.kind).toBe("infra");
    });

    it("classifies --jsx is not set on untouched files as infra", () => {
      const results: StageResult[] = [
        makeStageResult({
          stage: "compile",
          passed: false,
          feedback: [
            {
              stage: "compile",
              errors: [
                {
                  f: "src/component.tsx",
                  l: 1,
                  e: "Option '--jsx' is not set. Did you mean to enable JSX?",
                  fix: "",
                },
              ],
            },
          ],
        }),
      ];

      const result = classifyFailure(results);
      expect(result.kind).toBe("infra");
    });
  });

  describe("code failures", () => {
    it("classifies real test failure as code", () => {
      const results: StageResult[] = [
        makeStageResult({
          stage: "test",
          passed: false,
          feedback: [
            {
              stage: "test",
              errors: [
                {
                  f: "src/calculator.test.ts",
                  l: 42,
                  e: "expected 3 but got 5",
                  fix: "Fix the calculation logic",
                },
              ],
            },
          ],
        }),
      ];

      const result = classifyFailure(results);
      expect(result.kind).toBe("code");
      expect(result.stage).toBe("test");
    });

    it("classifies review failure as code", () => {
      const results: StageResult[] = [
        makeStageResult({
          stage: "review",
          passed: false,
          feedback: [
            {
              stage: "review",
              errors: [
                {
                  f: "src/auth.ts",
                  l: 10,
                  e: "Missing input validation before database call",
                  fix: "Add validation",
                },
              ],
            },
          ],
        }),
      ];

      const result = classifyFailure(results);
      expect(result.kind).toBe("code");
      expect(result.stage).toBe("review");
    });
  });

  describe("timeout / budget from spawn errors", () => {
    it("returns timeout for empty stage results with no spawn error", () => {
      const result = classifyFailure([]);
      expect(result.kind).toBe("timeout");
      expect(result.stage).toBe("spawn");
    });

    it("returns timeout for empty stage results with rate_limit spawn error", () => {
      const result = classifyFailure([], "rate_limit exceeded");
      expect(result.kind).toBe("timeout");
    });

    it("returns timeout for empty stage results with 429 spawn error", () => {
      const result = classifyFailure([], "HTTP 429 Too Many Requests");
      expect(result.kind).toBe("timeout");
    });

    it("returns budget for empty stage results with budget spawn error", () => {
      const result = classifyFailure([], "budget exceeded");
      expect(result.kind).toBe("budget");
    });
  });
});

// packages/core/src/stages/review.test.ts
import { describe, it, expect } from "vitest";
import { buildReviewPrompt, parseReviewResponse } from "./review.js";

describe("review stage", () => {
  describe("buildReviewPrompt", () => {
    it("includes diff in prompt", () => {
      const prompt = buildReviewPrompt(
        "diff --git a/src/index.ts\n+export const x = 1;",
        "export interface Player { name: string; }",
        "Build a players API",
      );
      expect(prompt).toContain("diff --git");
      expect(prompt).toContain("Player");
      expect(prompt).toContain("players API");
    });
  });

  describe("parseReviewResponse", () => {
    it("returns passed when response says approved", () => {
      const result = parseReviewResponse('{"approved":true,"issues":[]}');
      expect(result.passed).toBe(true);
      expect(result.feedback).toHaveLength(0);
    });

    it("returns failed with issues when response has problems", () => {
      const result = parseReviewResponse(
        '{"approved":false,"issues":[{"f":"src/index.ts","l":5,"e":"Uses local Player type instead of contracts","fix":"Import Player from contracts.ts"}]}',
      );
      expect(result.passed).toBe(false);
      expect(result.feedback).toHaveLength(1);
      expect(result.feedback[0]!.errors[0]!.f).toBe("src/index.ts");
    });

    it("returns failed on unparseable response", () => {
      const result = parseReviewResponse("I think the code looks mostly fine but...");
      expect(result.passed).toBe(false);
    });
  });
});

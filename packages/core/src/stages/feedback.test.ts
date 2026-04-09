// packages/core/src/stages/feedback.test.ts
import { describe, it, expect } from "vitest";
import { digestReviewIssues, parseFeedbackResponse } from "./feedback.js";

describe("feedback digester", () => {
  describe("digestReviewIssues", () => {
    it("converts raw review issues to StageFeedback", () => {
      const rawReview = '{"issues":[{"f":"src/index.ts","l":5,"e":"Wrong type","fix":"Use Player from contracts"}]}';
      const result = digestReviewIssues(rawReview);
      expect(result.stage).toBe("review");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.f).toBe("src/index.ts");
    });

    it("returns empty errors on unparseable input", () => {
      const result = digestReviewIssues("not json");
      expect(result.stage).toBe("review");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.e).toContain("parse");
    });
  });

  describe("parseFeedbackResponse", () => {
    it("parses valid JSON feedback", () => {
      const response = '{"errors":[{"f":"src/a.ts","l":10,"e":"Type error","fix":"Change type"}]}';
      const result = parseFeedbackResponse(response, "compile");
      expect(result.stage).toBe("compile");
      expect(result.errors).toHaveLength(1);
    });

    it("handles markdown-fenced JSON", () => {
      const response = '```json\n{"errors":[{"f":"src/a.ts","l":1,"e":"error","fix":"fix"}]}\n```';
      const result = parseFeedbackResponse(response, "test");
      expect(result.errors).toHaveLength(1);
    });

    it("returns raw error on unparseable response", () => {
      const result = parseFeedbackResponse("AI could not parse the errors", "compile");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.e).toContain("could not parse");
    });
  });
});

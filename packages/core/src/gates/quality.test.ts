import { describe, it, expect } from "vitest";
import { buildQualityPrompt, parseQualityResponse, createQualityGateCheck } from "./quality.js";
import type { WorkerOutput, WorkTree, CodeTree } from "../types.js";

const emptyWorkTree: WorkTree = { milestones: [] };
const emptyCodeTree: CodeTree = { modules: [] };

function makeOutput(overrides: Partial<WorkerOutput> = {}): WorkerOutput {
  return {
    status: "complete",
    filesChanged: ["a.ts"],
    interfacesModified: [],
    testsAdded: [],
    testResults: { pass: 5, fail: 0 },
    notes: "",
    tokensUsed: 3000,
    ...overrides,
  };
}

describe("quality gate", () => {
  describe("buildQualityPrompt", () => {
    it("includes the diff and standards in the prompt", () => {
      const prompt = buildQualityPrompt("+ const x = 1;", "Use const, not let.");
      expect(prompt).toContain("+ const x = 1;");
      expect(prompt).toContain("Use const, not let.");
    });

    it("requests JSON-only output", () => {
      const prompt = buildQualityPrompt("diff", "standards");
      expect(prompt).toContain("json-only");
      expect(prompt).toContain('"pass"');
      expect(prompt).toContain('"issues"');
    });
  });

  describe("parseQualityResponse", () => {
    it("parses a passing review", () => {
      const response = JSON.stringify({ pass: true, issues: [] });
      const result = parseQualityResponse(response);
      expect(result).not.toBeNull();
      expect(result!.pass).toBe(true);
      expect(result!.issues).toHaveLength(0);
    });

    it("parses a failing review with issues", () => {
      const response = JSON.stringify({
        pass: false,
        issues: [{ rule: "naming", file: "a.ts", note: "Bad variable name", severity: "low" }],
      });
      const result = parseQualityResponse(response);
      expect(result).not.toBeNull();
      expect(result!.pass).toBe(false);
      expect(result!.issues).toHaveLength(1);
      expect(result!.issues[0]!.rule).toBe("naming");
    });

    it("returns null for invalid JSON", () => {
      expect(parseQualityResponse("not json")).toBeNull();
    });

    it("returns null when pass field is missing", () => {
      expect(parseQualityResponse(JSON.stringify({ issues: [] }))).toBeNull();
    });

    it("returns null when issues field is missing", () => {
      expect(parseQualityResponse(JSON.stringify({ pass: true }))).toBeNull();
    });
  });

  describe("createQualityGateCheck", () => {
    it("passes when no anti-patterns found", () => {
      const check = createQualityGateCheck("Use strict TypeScript");
      const result = check.run(
        makeOutput({ notes: "Clean implementation" }),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(result.pass).toBe(true);
      expect(result.layer).toBe("quality");
    });

    it("flags anti-patterns in notes with low severity (still passes)", () => {
      const check = createQualityGateCheck("Use strict TypeScript");
      const result = check.run(
        makeOutput({ notes: "Added TODO for later cleanup" }),
        emptyWorkTree,
        emptyCodeTree,
      );
      // Low severity issues don't cause a fail
      expect(result.pass).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]!.rule).toBe("quality-anti-pattern");
    });

    it("flags complete status with no file changes", () => {
      const check = createQualityGateCheck("Standards apply");
      const result = check.run(
        makeOutput({ filesChanged: [], status: "complete" }),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(result.issues.some((i) => i.rule === "quality-no-changes")).toBe(true);
    });
  });
});

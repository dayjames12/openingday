import { describe, it, expect } from "vitest";
import {
  runGatePipeline,
  automatedTestGate,
  treeCheckGate,
  securityGate,
  allGatesPassed,
  getHighSeverityIssues,
  countIssuesBySeverity,
  createDefaultPipeline,
} from "./pipeline.js";
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

describe("gate pipeline", () => {
  describe("automatedTestGate", () => {
    it("passes when all tests pass", () => {
      const gate = automatedTestGate();
      const result = gate.run(makeOutput(), emptyWorkTree, emptyCodeTree);
      expect(result.pass).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("fails when tests fail", () => {
      const gate = automatedTestGate();
      const result = gate.run(
        makeOutput({ testResults: { pass: 3, fail: 2 } }),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(result.pass).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.severity).toBe("high");
    });
  });

  describe("treeCheckGate", () => {
    it("passes when all changed files are declared", () => {
      const gate = treeCheckGate(["a.ts", "b.ts"]);
      const result = gate.run(makeOutput({ filesChanged: ["a.ts"] }), emptyWorkTree, emptyCodeTree);
      expect(result.pass).toBe(true);
    });

    it("fails when undeclared files are changed", () => {
      const gate = treeCheckGate(["a.ts"]);
      const result = gate.run(
        makeOutput({ filesChanged: ["a.ts", "secret.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(result.pass).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.file).toBe("secret.ts");
    });
  });

  describe("securityGate", () => {
    it("passes when no dangerous patterns found", () => {
      const gate = securityGate();
      const result = gate.run(makeOutput({ notes: "All good" }), emptyWorkTree, emptyCodeTree);
      expect(result.pass).toBe(true);
    });

    it("fails when dangerous pattern found in notes", () => {
      const gate = securityGate();
      const result = gate.run(
        makeOutput({ notes: "Used eval( to parse data" }),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(result.pass).toBe(false);
      expect(result.issues[0]!.rule).toBe("dangerous-pattern");
    });
  });

  describe("runGatePipeline", () => {
    it("runs all checks and returns overall pass", async () => {
      const checks = [automatedTestGate(), treeCheckGate(["a.ts"])];
      const { results, passed } = await runGatePipeline(
        checks,
        makeOutput(),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(results).toHaveLength(2);
      expect(passed).toBe(true);
    });

    it("returns overall fail if any check fails", async () => {
      const checks = [
        automatedTestGate(),
        treeCheckGate(["b.ts"]), // a.ts not declared
      ];
      const { results, passed } = await runGatePipeline(
        checks,
        makeOutput({ filesChanged: ["a.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
      );
      expect(passed).toBe(false);
      expect(results[0]!.pass).toBe(true); // tests pass
      expect(results[1]!.pass).toBe(false); // tree check fails
    });
  });

  describe("allGatesPassed", () => {
    it("returns true when all pass", () => {
      const results = [
        { layer: "automated" as const, pass: true, issues: [], timestamp: "" },
        { layer: "security" as const, pass: true, issues: [], timestamp: "" },
      ];
      expect(allGatesPassed(results)).toBe(true);
    });

    it("returns false when any fails", () => {
      const results = [
        { layer: "automated" as const, pass: true, issues: [], timestamp: "" },
        { layer: "security" as const, pass: false, issues: [], timestamp: "" },
      ];
      expect(allGatesPassed(results)).toBe(false);
    });
  });

  describe("getHighSeverityIssues", () => {
    it("filters to high severity issues", () => {
      const results = [
        {
          layer: "automated" as const,
          pass: false,
          issues: [
            { severity: "high" as const, rule: "test-fail", file: "" },
            { severity: "low" as const, rule: "lint", file: "" },
          ],
          timestamp: "",
        },
      ];
      const high = getHighSeverityIssues(results);
      expect(high).toHaveLength(1);
      expect(high[0]!.rule).toBe("test-fail");
    });
  });

  describe("countIssuesBySeverity", () => {
    it("counts issues by severity", () => {
      const results = [
        {
          layer: "automated" as const,
          pass: false,
          issues: [
            { severity: "high" as const, rule: "a", file: "" },
            { severity: "high" as const, rule: "b", file: "" },
            { severity: "low" as const, rule: "c", file: "" },
          ],
          timestamp: "",
        },
      ];
      expect(countIssuesBySeverity(results)).toEqual({ high: 2, low: 1 });
    });
  });

  describe("createDefaultPipeline", () => {
    it("creates a pipeline with 3 gates", () => {
      const pipeline = createDefaultPipeline(["a.ts"]);
      expect(pipeline).toHaveLength(3);
      expect(pipeline.map((g) => g.layer)).toEqual(["automated", "tree-check", "security"]);
    });
  });
});

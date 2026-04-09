import { describe, it, expect } from "vitest";
import { simulateExecution } from "./simulate.js";
import type { WorkTree, CodeTree } from "../types.js";

function makeWorkTree(tasks: { id: string; deps: string[]; touches: string[]; reads: string[] }[]): WorkTree {
  return {
    milestones: [{
      id: "m1",
      name: "m1",
      description: "milestone",
      dependencies: [],
      slices: [{
        id: "m1-s1",
        name: "s1",
        description: "slice",
        parentMilestoneId: "m1",
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.id,
          description: `Task ${t.id} implementation with tests`,
          status: "pending" as const,
          dependencies: t.deps,
          touches: t.touches,
          reads: t.reads,
          worker: null,
          tokenSpend: 0,
          attemptCount: 0,
          gateResults: [],
          parentSliceId: "m1-s1",
        })),
      }],
    }],
  };
}

function makeCodeTree(files: string[]): CodeTree {
  return {
    modules: [{
      path: "src",
      description: "source",
      files: files.map((p) => ({
        path: p,
        description: p,
        exports: [],
        imports: [],
        lastModifiedBy: null,
      })),
    }],
  };
}

describe("simulateExecution", () => {
  it("returns execution order for simple chain", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: [] },
      { id: "t2", deps: ["t1"], touches: ["src/b.ts"], reads: ["src/a.ts"] },
      { id: "t3", deps: ["t2"], touches: ["src/c.ts"], reads: ["src/b.ts"] },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const result = simulateExecution(wt, ct);
    expect(result.executionOrder).toEqual(["t1", "t2", "t3"]);
  });

  it("detects missing dependency when task reads file written by non-dependency", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: [] },
      { id: "t2", deps: [], touches: ["src/b.ts"], reads: ["src/a.ts"] },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts"]);
    const result = simulateExecution(wt, ct);
    expect(result.addedDependencies.length).toBeGreaterThan(0);
    expect(result.addedDependencies[0]).toEqual(["t2", "t1"]);
  });

  it("returns optimized order with parallel-capable tasks", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: [] },
      { id: "t2", deps: [], touches: ["src/b.ts"], reads: [] },
      { id: "t3", deps: ["t1", "t2"], touches: ["src/c.ts"], reads: [] },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const result = simulateExecution(wt, ct);
    // t1 and t2 can be parallel, t3 must come after both
    const t1Idx = result.executionOrder.indexOf("t1");
    const t2Idx = result.executionOrder.indexOf("t2");
    const t3Idx = result.executionOrder.indexOf("t3");
    expect(t3Idx).toBeGreaterThan(t1Idx);
    expect(t3Idx).toBeGreaterThan(t2Idx);
  });

  it("warns when task has no context from prior tasks", () => {
    const wt = makeWorkTree([
      { id: "t1", deps: [], touches: ["src/a.ts"], reads: ["src/missing.ts"] },
    ]);
    const ct = makeCodeTree(["src/a.ts"]);
    const result = simulateExecution(wt, ct);
    expect(result.warnings.some((w) => w.includes("missing.ts"))).toBe(true);
  });
});

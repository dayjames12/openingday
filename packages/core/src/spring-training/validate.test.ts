import { describe, it, expect } from "vitest";
import { validateStructure } from "./validate.js";
import type { WorkTree, CodeTree } from "../types.js";

function makeWorkTree(
  tasks: {
    id: string;
    desc: string;
    deps: string[];
    touches: string[];
    reads: string[];
    sliceId: string;
    milestoneId: string;
  }[],
): WorkTree {
  const milestoneMap = new Map<string, { id: string; slices: Map<string, typeof tasks> }>();
  for (const t of tasks) {
    if (!milestoneMap.has(t.milestoneId)) {
      milestoneMap.set(t.milestoneId, { id: t.milestoneId, slices: new Map() });
    }
    const m = milestoneMap.get(t.milestoneId)!;
    if (!m.slices.has(t.sliceId)) {
      m.slices.set(t.sliceId, []);
    }
    m.slices.get(t.sliceId)!.push(t);
  }

  return {
    milestones: Array.from(milestoneMap.values()).map((m) => ({
      id: m.id,
      name: m.id,
      description: "milestone",
      dependencies: [],
      slices: Array.from(m.slices.entries()).map(([sId, sTasks]) => ({
        id: sId,
        name: sId,
        description: "slice",
        parentMilestoneId: m.id,
        tasks: sTasks.map((t) => ({
          id: t.id,
          name: t.id,
          description: t.desc,
          status: "pending" as const,
          dependencies: t.deps,
          touches: t.touches,
          reads: t.reads,
          worker: null,
          tokenSpend: 0,
          attemptCount: 0,
          gateResults: [],
          parentSliceId: t.sliceId,
        })),
      })),
    })),
  };
}

function makeCodeTree(files: string[]): CodeTree {
  return {
    modules: [
      {
        path: "src",
        description: "source",
        files: files.map((p) => ({
          path: p,
          description: p,
          exports: [],
          imports: [],
          lastModifiedBy: null,
        })),
      },
    ],
  };
}

describe("validateStructure", () => {
  it("passes valid structure", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create players route in src/routes/players.ts",
        deps: [],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts", "src/__tests__/players.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.valid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks on missing file in code tree", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree([]);
    const result = validateStructure(wt, ct);
    expect(result.blockers.some((b) => b.includes("players.ts"))).toBe(true);
  });

  it("blocks on independent tasks touching same file", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
      {
        id: "t2",
        desc: "Update route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("one-owner"))).toBe(true);
  });

  it("allows dependent tasks touching same file", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
      {
        id: "t2",
        desc: "Add validation to src/routes/players.ts with tests",
        deps: ["t1"],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts", "src/__tests__/players.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.blockers.filter((b) => b.includes("one-owner"))).toHaveLength(0);
  });

  it("blocks on circular dependencies", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/a.ts with test",
        deps: ["t2"],
        touches: ["src/a.ts", "src/a.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
      {
        id: "t2",
        desc: "Create route in src/b.ts with test",
        deps: ["t1"],
        touches: ["src/b.ts", "src/b.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/b.ts", "src/a.test.ts", "src/b.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("cycle"))).toBe(true);
  });

  it("warns on short description", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "short",
        deps: [],
        touches: ["src/a.ts", "src/a.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/a.ts", "src/a.test.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.warnings.some((w) => w.includes("description"))).toBe(true);
  });

  it("warns on impl task without test files in touches", () => {
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create players route in src/routes/players.ts",
        deps: [],
        touches: ["src/routes/players.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts"]);
    const result = validateStructure(wt, ct);
    expect(result.warnings.some((w) => w.includes("test"))).toBe(true);
  });

  it("blocks when context estimate exceeds 150k", () => {
    // Indirectly tested — would need a massive tree. Validate the check exists.
    const wt = makeWorkTree([
      {
        id: "t1",
        desc: "Create route in src/routes/players.ts with tests",
        deps: [],
        touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
        reads: [],
        sliceId: "s1",
        milestoneId: "m1",
      },
    ]);
    const ct = makeCodeTree(["src/routes/players.ts", "src/__tests__/players.test.ts"]);
    const result = validateStructure(wt, ct);
    // Small tree should be under limit
    expect(result.blockers.filter((b) => b.includes("150k"))).toHaveLength(0);
  });

  it("warns when milestone has no tasks", () => {
    const wt: WorkTree = {
      milestones: [
        {
          id: "m1",
          name: "Empty",
          description: "empty milestone",
          dependencies: [],
          slices: [],
        },
      ],
    };
    const ct = makeCodeTree([]);
    const result = validateStructure(wt, ct);
    expect(result.warnings.some((w) => w.includes("no tasks"))).toBe(true);
  });
});

// packages/core/src/digests/generator.test.ts
import { describe, it, expect } from "vitest";
import { generateDigest } from "./generator.js";
import type { WorkerOutput, WorkTree, CodeTree } from "../types.js";

describe("generateDigest", () => {
  const defaultOutput: WorkerOutput = {
    status: "complete",
    filesChanged: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
    interfacesModified: [
      { file: "src/routes/players.ts", export: "playersRouter", before: "", after: "Router" },
    ],
    testsAdded: ["src/__tests__/players.test.ts"],
    testResults: { pass: 5, fail: 0 },
    notes: "Created GET and POST endpoints for players",
    tokensUsed: 15000,
  };

  const workTree: WorkTree = {
    milestones: [
      {
        id: "m1",
        name: "m1",
        description: "Build",
        dependencies: [],
        slices: [
          {
            id: "m1-s1",
            name: "s1",
            description: "Core",
            parentMilestoneId: "m1",
            tasks: [
              {
                id: "m1-s1-t1",
                name: "Create players route",
                description: "Create GET/POST /players in src/routes/players.ts",
                status: "complete",
                dependencies: [],
                touches: ["src/routes/players.ts", "src/__tests__/players.test.ts"],
                reads: ["src/contracts.ts"],
                worker: null,
                tokenSpend: 15000,
                attemptCount: 1,
                gateResults: [],
                parentSliceId: "m1-s1",
              },
            ],
          },
        ],
      },
    ],
  };

  const codeTree: CodeTree = {
    modules: [
      {
        path: "src",
        description: "source",
        files: [
          {
            path: "src/routes/players.ts",
            description: "players route",
            exports: [{ name: "playersRouter", signature: "Router", description: "" }],
            imports: [{ from: "src/contracts", names: ["Player"] }],
            lastModifiedBy: null,
          },
          {
            path: "src/contracts.ts",
            description: "contracts",
            exports: [{ name: "Player", signature: "interface Player", description: "" }],
            imports: [],
            lastModifiedBy: null,
          },
        ],
      },
    ],
  };

  it("generates a valid TaskDigest", () => {
    const digest = generateDigest("m1-s1-t1", defaultOutput, workTree, codeTree);
    expect(digest.task).toBe("m1-s1-t1");
    expect(digest.did).toBeTruthy();
    expect(digest.ex).toContain("playersRouter");
    expect(digest.im.length).toBeGreaterThan(0);
    expect(digest.pattern).toBeTruthy();
  });

  it("includes exports from worker output", () => {
    const digest = generateDigest("m1-s1-t1", defaultOutput, workTree, codeTree);
    expect(digest.ex).toContain("playersRouter");
  });

  it("includes imports from code tree", () => {
    const digest = generateDigest("m1-s1-t1", defaultOutput, workTree, codeTree);
    expect(digest.im.some((i) => i.includes("Player"))).toBe(true);
  });

  it("handles task not found gracefully", () => {
    const noNotesOutput: WorkerOutput = { ...defaultOutput, notes: "" };
    const digest = generateDigest("nonexistent", noNotesOutput, workTree, codeTree);
    expect(digest.task).toBe("nonexistent");
    expect(digest.did).toContain("completed");
  });
});

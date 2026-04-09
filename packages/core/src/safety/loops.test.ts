// packages/core/src/safety/loops.test.ts
import { describe, it, expect } from "vitest";
import { createLoopTracker, recordLoop, shouldBreak } from "./loops.js";
import type { StageFeedback } from "../types.js";

describe("loop tracking", () => {
  describe("createLoopTracker", () => {
    it("creates tracker with zero loops", () => {
      const tracker = createLoopTracker("m1-s1-t1");
      expect(tracker.taskId).toBe("m1-s1-t1");
      expect(tracker.totalLoops).toBe(0);
      expect(tracker.stageLoopIds).toHaveLength(0);
    });
  });

  describe("recordLoop", () => {
    it("increments loop count and adds ID", () => {
      let tracker = createLoopTracker("t1");
      tracker = recordLoop(tracker, "compile");
      expect(tracker.totalLoops).toBe(1);
      expect(tracker.stageLoopIds).toHaveLength(1);
      expect(tracker.stageLoopIds[0]).toContain("compile");
    });
  });

  describe("shouldBreak", () => {
    it("returns false when under limits", () => {
      const tracker = createLoopTracker("t1");
      const errors: StageFeedback[] = [
        { stage: "compile", errors: [{ f: "a.ts", l: 1, e: "error1", fix: "fix1" }] },
      ];
      const result = shouldBreak(tracker, "compile", errors, []);
      expect(result.break).toBe(false);
    });

    it("breaks after 5 loops in same stage", () => {
      let tracker = createLoopTracker("t1");
      for (let i = 0; i < 5; i++) {
        tracker = recordLoop(tracker, "compile");
      }
      const result = shouldBreak(tracker, "compile", [], []);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("max");
    });

    it("breaks when same error appears 3 times", () => {
      const tracker = createLoopTracker("t1");
      const sameError: StageFeedback = {
        stage: "compile",
        errors: [{ f: "a.ts", l: 1, e: "Cannot find module X", fix: "install X" }],
      };
      const errorHistory = [sameError, sameError, sameError];
      const result = shouldBreak(tracker, "compile", errorHistory, []);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("Same error");
    });

    it("breaks at 15 total loops", () => {
      let tracker = createLoopTracker("t1");
      for (let i = 0; i < 15; i++) {
        tracker = recordLoop(tracker, i < 5 ? "compile" : i < 10 ? "test" : "review");
      }
      const result = shouldBreak(tracker, "review", [], []);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("Total");
    });

    it("breaks when identical diff appears twice", () => {
      const tracker = createLoopTracker("t1");
      const diffs = ["diff --git a/src/a.ts\n+line1", "diff --git a/src/a.ts\n+line1"];
      const result = shouldBreak(tracker, "compile", [], diffs);
      expect(result.break).toBe(true);
      expect(result.reason).toContain("Identical diff");
    });

    it("breaks at 50 loop IDs", () => {
      let tracker = createLoopTracker("t1");
      for (let i = 0; i < 50; i++) {
        tracker = recordLoop(tracker, "compile");
      }
      const result = shouldBreak(tracker, "compile", [], []);
      expect(result.break).toBe(true);
    });
  });
});

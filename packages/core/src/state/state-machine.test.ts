import { describe, it, expect } from "vitest";
import {
  createProjectState,
  canTransition,
  getValidTransitions,
  transition,
  addTokenSpend,
  incrementWorkersSpawned,
  isTerminal,
  isActive,
} from "./state-machine.js";

describe("state-machine", () => {
  it("creates initial state as idle", () => {
    const state = createProjectState();
    expect(state.status).toBe("idle");
    expect(state.totalTokenSpend).toBe(0);
    expect(state.totalWorkersSpawned).toBe(0);
    expect(state.pausedAt).toBeNull();
  });

  describe("transitions", () => {
    it("allows idle -> seeding", () => {
      expect(canTransition("idle", "seeding")).toBe(true);
    });

    it("allows seeding -> running", () => {
      expect(canTransition("seeding", "running")).toBe(true);
    });

    it("allows seeding -> failed", () => {
      expect(canTransition("seeding", "failed")).toBe(true);
    });

    it("allows running -> paused", () => {
      expect(canTransition("running", "paused")).toBe(true);
    });

    it("allows running -> complete", () => {
      expect(canTransition("running", "complete")).toBe(true);
    });

    it("allows running -> failed", () => {
      expect(canTransition("running", "failed")).toBe(true);
    });

    it("allows paused -> running", () => {
      expect(canTransition("paused", "running")).toBe(true);
    });

    it("allows failed -> idle (reset)", () => {
      expect(canTransition("failed", "idle")).toBe(true);
    });

    it("blocks idle -> running (must seed first)", () => {
      expect(canTransition("idle", "running")).toBe(false);
    });

    it("blocks complete -> anything", () => {
      expect(canTransition("complete", "idle")).toBe(false);
      expect(canTransition("complete", "running")).toBe(false);
    });

    it("blocks running -> idle", () => {
      expect(canTransition("running", "idle")).toBe(false);
    });
  });

  describe("transition()", () => {
    it("transitions state and returns new object", () => {
      const s1 = createProjectState();
      const s2 = transition(s1, "seeding");
      expect(s2.status).toBe("seeding");
      expect(s1.status).toBe("idle"); // immutable
    });

    it("throws on invalid transition", () => {
      const state = createProjectState();
      expect(() => transition(state, "running")).toThrow("Invalid transition: idle -> running");
    });

    it("sets pausedAt when transitioning to paused", () => {
      let state = createProjectState();
      state = transition(state, "seeding");
      state = transition(state, "running");
      state = transition(state, "paused");
      expect(state.pausedAt).not.toBeNull();
    });

    it("clears pausedAt when resuming from paused", () => {
      let state = createProjectState();
      state = transition(state, "seeding");
      state = transition(state, "running");
      state = transition(state, "paused");
      expect(state.pausedAt).not.toBeNull();
      state = transition(state, "running");
      expect(state.pausedAt).toBeNull();
    });

    it("follows full lifecycle: idle -> seeding -> running -> complete", () => {
      let state = createProjectState();
      state = transition(state, "seeding");
      state = transition(state, "running");
      state = transition(state, "complete");
      expect(state.status).toBe("complete");
    });
  });

  describe("getValidTransitions", () => {
    it("returns valid transitions for idle", () => {
      expect(getValidTransitions("idle")).toEqual(["seeding"]);
    });

    it("returns empty for complete", () => {
      expect(getValidTransitions("complete")).toEqual([]);
    });

    it("returns multiple for running", () => {
      const valid = getValidTransitions("running");
      expect(valid).toContain("paused");
      expect(valid).toContain("complete");
      expect(valid).toContain("failed");
    });
  });

  describe("addTokenSpend", () => {
    it("adds tokens to state", () => {
      let state = createProjectState();
      state = addTokenSpend(state, 1000);
      expect(state.totalTokenSpend).toBe(1000);
      state = addTokenSpend(state, 500);
      expect(state.totalTokenSpend).toBe(1500);
    });
  });

  describe("incrementWorkersSpawned", () => {
    it("increments worker count", () => {
      let state = createProjectState();
      state = incrementWorkersSpawned(state);
      expect(state.totalWorkersSpawned).toBe(1);
      state = incrementWorkersSpawned(state);
      expect(state.totalWorkersSpawned).toBe(2);
    });
  });

  describe("isTerminal", () => {
    it("complete is terminal", () => {
      expect(isTerminal("complete")).toBe(true);
    });

    it("failed is terminal", () => {
      expect(isTerminal("failed")).toBe(true);
    });

    it("running is not terminal", () => {
      expect(isTerminal("running")).toBe(false);
    });
  });

  describe("isActive", () => {
    it("running is active", () => {
      expect(isActive("running")).toBe(true);
    });

    it("seeding is active", () => {
      expect(isActive("seeding")).toBe(true);
    });

    it("paused is not active", () => {
      expect(isActive("paused")).toBe(false);
    });

    it("idle is not active", () => {
      expect(isActive("idle")).toBe(false);
    });
  });
});

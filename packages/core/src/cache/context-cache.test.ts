import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getCachedContext, setCachedContext, invalidateContext, clearContextCache } from "./context-cache.js";
import type { EnrichedContextPackage } from "../types.js";

function makeContext(taskName: string): EnrichedContextPackage {
  return {
    task: { name: taskName, description: "test", acceptanceCriteria: [] },
    interfaces: [],
    above: [],
    below: [],
    memory: "",
    rules: "",
    budget: { softLimit: 100, hardLimit: 200 },
    landscape: { mc: 0, fc: 0, modules: [] },
    relevant: [],
    fileContents: {},
    contracts: "",
    digests: [],
    specExcerpt: "",
  };
}

describe("context-cache", () => {
  beforeEach(() => {
    clearContextCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for uncached task", () => {
    expect(getCachedContext("t1")).toBeNull();
  });

  it("returns cached context within TTL", () => {
    const ctx = makeContext("t1");
    setCachedContext("t1", ctx);
    expect(getCachedContext("t1")).toBe(ctx);
  });

  it("returns null after TTL expires", () => {
    const ctx = makeContext("t1");
    setCachedContext("t1", ctx);
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes > 5 minute TTL
    expect(getCachedContext("t1")).toBeNull();
  });

  it("invalidates specific task", () => {
    setCachedContext("t1", makeContext("t1"));
    setCachedContext("t2", makeContext("t2"));
    invalidateContext("t1");
    expect(getCachedContext("t1")).toBeNull();
    expect(getCachedContext("t2")).not.toBeNull();
  });

  it("clears all cached contexts", () => {
    setCachedContext("t1", makeContext("t1"));
    setCachedContext("t2", makeContext("t2"));
    clearContextCache();
    expect(getCachedContext("t1")).toBeNull();
    expect(getCachedContext("t2")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { defaultConfig } from "./defaults.js";

describe("defaultConfig", () => {
  it("returns a valid ProjectConfig with the given name and specPath", () => {
    const config = defaultConfig("my-project", "specs/api.md");
    expect(config.name).toBe("my-project");
    expect(config.specPath).toBe("specs/api.md");
  });

  it("sets project budget to $100 with 70% warning", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.budgets.project.usd).toBe(100);
    expect(config.budgets.project.warnPct).toBe(70);
  });

  it("sets per-task budget to $5 with 75% soft limit", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.budgets.perTask.usd).toBe(5);
    expect(config.budgets.perTask.softPct).toBe(75);
  });

  it("sets supervisor budget to $3 and planning budget to $5", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.budgets.supervisor.usd).toBe(3);
    expect(config.budgets.planning.usd).toBe(5);
  });

  it("sets maxConcurrentWorkers to 3", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.limits.maxConcurrentWorkers).toBe(3);
  });

  it("sets maxTotalWorkers to 50 and maxRetries to 3", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.limits.maxTotalWorkers).toBe(50);
    expect(config.limits.maxRetries).toBe(3);
  });

  it("sets maxTaskDepth to 4 and sessionTimeoutMin to 15", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.limits.maxTaskDepth).toBe(4);
    expect(config.limits.sessionTimeoutMin).toBe(15);
  });

  it("sets spawnRatePerMin to 5", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.limits.spawnRatePerMin).toBe(5);
  });

  it("sets circuit breaker defaults", () => {
    const config = defaultConfig("test", "spec.md");
    expect(config.circuitBreakers.consecutiveFailuresSlice).toBe(3);
    expect(config.circuitBreakers.consecutiveFailuresProject).toBe(5);
    expect(config.circuitBreakers.budgetEfficiencyThreshold).toBe(0.5);
  });

  it("returns a fresh object each call (no shared references)", () => {
    const a = defaultConfig("a", "a.md");
    const b = defaultConfig("b", "b.md");
    expect(a).not.toBe(b);
    expect(a.budgets).not.toBe(b.budgets);
    expect(a.limits).not.toBe(b.limits);
  });
});

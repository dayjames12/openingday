// packages/core/src/safety/watchdog.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWatchdog } from "./watchdog.js";
import type { WatchdogState } from "../types.js";

describe("watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns continue when task completed recently", () => {
    const now = new Date();
    const state: WatchdogState = {
      lastTaskCompletedAt: now.toISOString(),
      warningIssued: false,
    };
    const watchdog = createWatchdog(state);
    const action = watchdog.check(now);
    expect(action).toBe("continue");
  });

  it("returns warn after 20 min of no progress", () => {
    const past = new Date(Date.now() - 21 * 60 * 1000);
    const state: WatchdogState = {
      lastTaskCompletedAt: past.toISOString(),
      warningIssued: false,
    };
    const watchdog = createWatchdog(state);
    const action = watchdog.check(new Date());
    expect(action).toBe("warn");
  });

  it("returns pause after 40 min of no progress", () => {
    const past = new Date(Date.now() - 41 * 60 * 1000);
    const state: WatchdogState = {
      lastTaskCompletedAt: past.toISOString(),
      warningIssued: true,
    };
    const watchdog = createWatchdog(state);
    const action = watchdog.check(new Date());
    expect(action).toBe("pause");
  });

  it("reset updates lastTaskCompletedAt", () => {
    const past = new Date(Date.now() - 25 * 60 * 1000);
    const state: WatchdogState = {
      lastTaskCompletedAt: past.toISOString(),
      warningIssued: true,
    };
    const watchdog = createWatchdog(state);
    const newState = watchdog.reset();
    expect(new Date(newState.lastTaskCompletedAt).getTime()).toBeGreaterThan(past.getTime());
    expect(newState.warningIssued).toBe(false);
  });
});

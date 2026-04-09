// packages/core/src/safety/watchdog.ts
import type { WatchdogState } from "../types.js";

export type WatchdogAction = "continue" | "warn" | "pause";

const WARN_THRESHOLD_MS = 20 * 60 * 1000;  // 20 minutes
const PAUSE_THRESHOLD_MS = 40 * 60 * 1000; // 40 minutes

export interface Watchdog {
  check(now?: Date): WatchdogAction;
  reset(): WatchdogState;
  getState(): WatchdogState;
}

/**
 * Create a watchdog that monitors progress and triggers actions
 * when no task has completed within thresholds.
 */
export function createWatchdog(initialState: WatchdogState): Watchdog {
  let state = { ...initialState };

  return {
    check(now?: Date): WatchdogAction {
      const currentTime = (now ?? new Date()).getTime();
      const lastCompleted = new Date(state.lastTaskCompletedAt).getTime();
      const elapsed = currentTime - lastCompleted;

      if (elapsed >= PAUSE_THRESHOLD_MS) {
        return "pause";
      }

      if (elapsed >= WARN_THRESHOLD_MS && !state.warningIssued) {
        state = { ...state, warningIssued: true };
        return "warn";
      }

      return "continue";
    },

    reset(): WatchdogState {
      state = {
        lastTaskCompletedAt: new Date().toISOString(),
        warningIssued: false,
      };
      return state;
    },

    getState(): WatchdogState {
      return { ...state };
    },
  };
}

/**
 * Create an initial watchdog state.
 */
export function createWatchdogState(): WatchdogState {
  return {
    lastTaskCompletedAt: new Date().toISOString(),
    warningIssued: false,
  };
}

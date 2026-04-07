import type { ProjectState, ProjectStatus } from "../types.js";

/**
 * Valid transitions for the project state machine.
 * Key = current status, Value = set of allowed next statuses.
 */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  idle: ["seeding"],
  seeding: ["running", "failed"],
  running: ["paused", "complete", "failed"],
  paused: ["running", "failed"],
  complete: [],
  failed: ["idle"],
};

export function createProjectState(): ProjectState {
  return {
    status: "idle",
    totalTokenSpend: 0,
    totalWorkersSpawned: 0,
    startedAt: new Date().toISOString(),
    pausedAt: null,
  };
}

/**
 * Check if a transition is valid.
 */
export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Get all valid next statuses from the current status.
 */
export function getValidTransitions(status: ProjectStatus): ProjectStatus[] {
  return [...TRANSITIONS[status]];
}

/**
 * Transition the project to a new status. Throws if invalid.
 */
export function transition(state: ProjectState, to: ProjectStatus): ProjectState {
  if (!canTransition(state.status, to)) {
    throw new Error(
      `Invalid transition: ${state.status} -> ${to}. Valid transitions: ${TRANSITIONS[state.status].join(", ") || "none"}`,
    );
  }

  const updated = { ...state, status: to };

  if (to === "paused") {
    updated.pausedAt = new Date().toISOString();
  } else if (to === "running" && state.status === "paused") {
    updated.pausedAt = null;
  }

  return updated;
}

/**
 * Record token spend on the project state.
 */
export function addTokenSpend(state: ProjectState, tokens: number): ProjectState {
  return { ...state, totalTokenSpend: state.totalTokenSpend + tokens };
}

/**
 * Increment the total workers spawned count.
 */
export function incrementWorkersSpawned(state: ProjectState): ProjectState {
  return { ...state, totalWorkersSpawned: state.totalWorkersSpawned + 1 };
}

/**
 * Check if the project is in a terminal state.
 */
export function isTerminal(status: ProjectStatus): boolean {
  return status === "complete" || status === "failed";
}

/**
 * Check if the project is in an active (work-producing) state.
 */
export function isActive(status: ProjectStatus): boolean {
  return status === "running" || status === "seeding";
}

import type {
  WorkTree,
  WorkMilestone,
  WorkSlice,
  WorkTask,
  TaskStatus,
} from "../types.js";

// === Internal Helper ===

/**
 * Maps over every task in the tree, applying `fn`. If `fn` returns null the
 * task is removed from its slice.
 */
function mapTasks(
  tree: WorkTree,
  fn: (task: WorkTask) => WorkTask | null,
): WorkTree {
  return {
    milestones: tree.milestones.map((m) => ({
      ...m,
      slices: m.slices.map((s) => ({
        ...s,
        tasks: s.tasks.map(fn).filter((t): t is WorkTask => t !== null),
      })),
    })),
  };
}

// === Factory ===

export function createWorkTree(): WorkTree {
  return { milestones: [] };
}

// === Milestone CRUD ===

export function addMilestone(
  tree: WorkTree,
  milestone: Pick<WorkMilestone, "id" | "name" | "description" | "dependencies">,
): WorkTree {
  const newMilestone: WorkMilestone = {
    id: milestone.id,
    name: milestone.name,
    description: milestone.description,
    dependencies: milestone.dependencies,
    slices: [],
  };
  return { milestones: [...tree.milestones, newMilestone] };
}

// === Slice CRUD ===

export function addSlice(
  tree: WorkTree,
  milestoneId: string,
  slice: Pick<WorkSlice, "id" | "name" | "description">,
): WorkTree {
  return {
    milestones: tree.milestones.map((m) => {
      if (m.id !== milestoneId) return m;
      const newSlice: WorkSlice = {
        id: slice.id,
        name: slice.name,
        description: slice.description,
        tasks: [],
        parentMilestoneId: milestoneId,
      };
      return { ...m, slices: [...m.slices, newSlice] };
    }),
  };
}

// === Task CRUD ===

export function addTask(
  tree: WorkTree,
  sliceId: string,
  task: Pick<WorkTask, "id" | "name" | "description" | "dependencies" | "touches" | "reads">,
): WorkTree {
  const newTask: WorkTask = {
    id: task.id,
    name: task.name,
    description: task.description,
    status: "pending",
    dependencies: task.dependencies,
    touches: task.touches,
    reads: task.reads,
    worker: null,
    tokenSpend: 0,
    attemptCount: 0,
    gateResults: [],
    parentSliceId: sliceId,
  };
  return {
    milestones: tree.milestones.map((m) => ({
      ...m,
      slices: m.slices.map((s) => {
        if (s.id !== sliceId) return s;
        return { ...s, tasks: [...s.tasks, newTask] };
      }),
    })),
  };
}

// === Task Queries ===

export function getAllTasks(tree: WorkTree): WorkTask[] {
  return tree.milestones.flatMap((m) => m.slices.flatMap((s) => s.tasks));
}

export function getTasksInSlice(tree: WorkTree, sliceId: string): WorkTask[] {
  for (const m of tree.milestones) {
    for (const s of m.slices) {
      if (s.id === sliceId) return s.tasks;
    }
  }
  return [];
}

export function getTask(tree: WorkTree, taskId: string): WorkTask | null {
  for (const m of tree.milestones) {
    for (const s of m.slices) {
      for (const t of s.tasks) {
        if (t.id === taskId) return t;
      }
    }
  }
  return null;
}

// === Task Updates ===

export function updateTaskStatus(
  tree: WorkTree,
  taskId: string,
  status: TaskStatus,
): WorkTree {
  return mapTasks(tree, (t) =>
    t.id === taskId ? { ...t, status } : t,
  );
}

export function updateTask(
  tree: WorkTree,
  taskId: string,
  updates: Partial<WorkTask>,
): WorkTree {
  return mapTasks(tree, (t) =>
    t.id === taskId ? { ...t, ...updates } : t,
  );
}

// === Scheduling ===

export function getReadyTasks(
  tree: WorkTree,
  activeFileLocks: string[],
): WorkTask[] {
  const allTasks = getAllTasks(tree);
  const completedIds = new Set(
    allTasks.filter((t) => t.status === "complete").map((t) => t.id),
  );
  const lockSet = new Set(activeFileLocks);

  return allTasks.filter((t) => {
    if (t.status !== "pending") return false;
    if (!t.dependencies.every((dep) => completedIds.has(dep))) return false;
    if (t.touches.some((f) => lockSet.has(f))) return false;
    return true;
  });
}

// === Task Splitting ===

export function splitTask(
  tree: WorkTree,
  taskId: string,
  newTasks: Pick<WorkTask, "id" | "name" | "description" | "dependencies" | "touches" | "reads">[],
): WorkTree {
  const original = getTask(tree, taskId);
  if (!original) return tree;

  const lastNewId = newTasks[newTasks.length - 1].id;

  // Build replacement tasks inheriting parentSliceId from original
  const replacements: WorkTask[] = newTasks.map((nt) => ({
    id: nt.id,
    name: nt.name,
    description: nt.description,
    status: "pending" as const,
    dependencies: nt.dependencies,
    touches: nt.touches,
    reads: nt.reads,
    worker: null,
    tokenSpend: 0,
    attemptCount: 0,
    gateResults: [],
    parentSliceId: original.parentSliceId,
  }));

  // Replace original task with new tasks in its slice, and update deps
  return {
    milestones: tree.milestones.map((m) => ({
      ...m,
      slices: m.slices.map((s) => ({
        ...s,
        tasks: s.tasks
          .flatMap((t) => {
            if (t.id === taskId) return replacements;
            return [t];
          })
          .map((t) => {
            // Rewrite any dependency on the original to point to the last new task
            if (t.dependencies.includes(taskId)) {
              return {
                ...t,
                dependencies: t.dependencies.map((d) =>
                  d === taskId ? lastNewId : d,
                ),
              };
            }
            return t;
          }),
      })),
    })),
  };
}

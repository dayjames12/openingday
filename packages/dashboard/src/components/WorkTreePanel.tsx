import { useState } from "react";
import type { DashboardMilestone, DashboardSlice, DashboardTask } from "../api/types.js";

interface WorkTreePanelProps {
  milestones: DashboardMilestone[];
}

const statusIcons: Record<string, string> = {
  pending: "\u25CB",    // ○
  in_progress: "\u27F3", // ⟳
  complete: "\u2713",    // ✓
  failed: "\u2717",      // ✗
  paused: "\u23F8",      // ⏸
};

const statusTextColors: Record<string, string> = {
  pending: "text-[var(--text-muted)]",
  in_progress: "text-[var(--accent-blue)]",
  complete: "text-[var(--accent-green)]",
  failed: "text-[var(--accent-red)]",
  paused: "text-[var(--accent-yellow)]",
};

function TaskRow({ task }: { task: DashboardTask }) {
  const icon = statusIcons[task.status] ?? "?";
  const color = statusTextColors[task.status] ?? "";
  const spend = task.tokenSpend > 0 ? `${(task.tokenSpend * 0.000008).toFixed(4)}` : "--";

  return (
    <div className="flex items-center gap-2 py-0.5 pl-10 text-xs">
      <span className={`w-4 text-center ${color}`}>{icon}</span>
      <span className="flex-1 text-[var(--text-primary)] truncate">{task.name}</span>
      <span className="text-[var(--text-muted)] tabular-nums w-16 text-right">${spend}</span>
    </div>
  );
}

function SliceSection({ slice }: { slice: DashboardSlice }) {
  const [open, setOpen] = useState(true);
  const completed = slice.tasks.filter((t) => t.status === "complete").length;
  const total = slice.tasks.length;

  return (
    <div className="pl-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left py-0.5 text-xs hover:bg-[var(--bg-tertiary)]/30 rounded px-1 transition-colors"
      >
        <span className="text-[var(--text-muted)] w-3">{open ? "\u25BE" : "\u25B8"}</span>
        <span className="text-[var(--text-secondary)] font-medium truncate flex-1">
          {slice.name}
        </span>
        <span className="text-[var(--text-muted)] tabular-nums">
          {completed}/{total}
        </span>
      </button>
      {open && slice.tasks.map((t) => <TaskRow key={t.id} task={t} />)}
    </div>
  );
}

function MilestoneSection({ milestone }: { milestone: DashboardMilestone }) {
  const [open, setOpen] = useState(true);
  const allTasks = milestone.slices.flatMap((s) => s.tasks);
  const completed = allTasks.filter((t) => t.status === "complete").length;
  const total = allTasks.length;

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left py-1 text-xs hover:bg-[var(--bg-tertiary)]/30 rounded px-1 transition-colors"
      >
        <span className="text-[var(--text-muted)] w-3">{open ? "\u25BE" : "\u25B8"}</span>
        <span className="text-[var(--text-primary)] font-bold truncate flex-1">
          {milestone.name}
        </span>
        <span className="text-[var(--text-muted)] tabular-nums text-xs">
          {completed}/{total}
        </span>
      </button>
      {open && milestone.slices.map((s) => <SliceSection key={s.id} slice={s} />)}
    </div>
  );
}

export function WorkTreePanel({ milestones }: WorkTreePanelProps) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 overflow-auto h-full">
      <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
        Work Tree
      </h2>
      {milestones.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No milestones yet</p>
      ) : (
        milestones.map((m) => <MilestoneSection key={m.id} milestone={m} />)
      )}
    </div>
  );
}

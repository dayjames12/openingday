import type { DashboardState } from "../api/types.js";

interface TopBarProps {
  state: DashboardState;
  onPause: () => void;
  onKill: () => void;
}

const statusColors: Record<string, string> = {
  idle: "bg-[var(--text-muted)]",
  seeding: "bg-[var(--accent-purple)]",
  running: "bg-[var(--accent-green)]",
  paused: "bg-[var(--accent-yellow)]",
  complete: "bg-[var(--accent-blue)]",
  failed: "bg-[var(--accent-red)]",
};

export function TopBar({ state, onPause, onKill }: TopBarProps) {
  const { config, costs } = state;
  const status = state.state.status;
  const badgeColor = statusColors[status] ?? "bg-[var(--text-muted)]";
  const budgetPct = Math.min(costs.percentUsed, 100);

  return (
    <header className="flex items-center gap-4 px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--bg-tertiary)]">
      <h1 className="text-sm font-bold tracking-wide text-[var(--text-primary)] mr-2">
        {config.name}
      </h1>

      <span
        className={`px-2 py-0.5 rounded text-xs font-bold uppercase text-[var(--bg-primary)] ${badgeColor}`}
      >
        {status}
      </span>

      <div className="flex-1 mx-4 max-w-xs">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-0.5">
          <span>Budget</span>
          <span>
            ${costs.totalSpentUsd.toFixed(2)} / ${costs.projectBudgetUsd.toFixed(2)}
          </span>
        </div>
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${budgetPct}%`,
              backgroundColor:
                budgetPct > 90
                  ? "var(--accent-red)"
                  : budgetPct > 70
                    ? "var(--accent-yellow)"
                    : "var(--accent-green)",
            }}
          />
        </div>
      </div>

      <div className="flex gap-2 ml-auto">
        <button
          onClick={onPause}
          disabled={status === "paused" || status === "complete" || status === "failed"}
          className="px-3 py-1 text-xs font-bold rounded bg-[var(--accent-yellow)] text-[var(--bg-primary)] hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          PAUSE
        </button>
        <button
          onClick={onKill}
          disabled={status === "complete" || status === "failed"}
          className="px-3 py-1 text-xs font-bold rounded bg-[var(--accent-red)] text-[var(--bg-primary)] hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          KILL
        </button>
      </div>
    </header>
  );
}

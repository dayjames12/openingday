import { useState, useEffect } from "react";
import type { DashboardWorker } from "../api/types.js";

interface WorkersPanelProps {
  workers: DashboardWorker[];
  maxConcurrent: number;
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function WorkerCard({ worker }: { worker: DashboardWorker }) {
  const [elapsedStr, setElapsedStr] = useState(elapsed(worker.startedAt));

  useEffect(() => {
    const id = setInterval(() => setElapsedStr(elapsed(worker.startedAt)), 1000);
    return () => clearInterval(id);
  }, [worker.startedAt]);

  return (
    <div className="bg-[var(--bg-tertiary)] rounded p-2.5 border border-[var(--accent-green)]/20">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse" />
        <span className="text-xs font-bold text-[var(--text-primary)] truncate flex-1">
          {worker.taskName}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
        <span className="tabular-nums">{elapsedStr}</span>
        <span className="tabular-nums">
          {worker.tokensUsed > 0 ? `${(worker.tokensUsed / 1000).toFixed(1)}k tok` : "--"}
        </span>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="bg-[var(--bg-tertiary)]/40 rounded p-2.5 border border-dashed border-[var(--text-muted)]/20">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]/30" />
        <span className="text-xs text-[var(--text-muted)]">idle</span>
      </div>
    </div>
  );
}

export function WorkersPanel({ workers, maxConcurrent }: WorkersPanelProps) {
  const emptySlots = Math.max(0, maxConcurrent - workers.length);

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
          Active Workers
        </h2>
        <span className="text-xs tabular-nums text-[var(--text-muted)]">
          {workers.length}/{maxConcurrent}
        </span>
      </div>
      <div className="grid gap-2">
        {workers.map((w) => (
          <WorkerCard key={w.id} worker={w} />
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <EmptySlot key={`empty-${i}`} />
        ))}
      </div>
    </div>
  );
}

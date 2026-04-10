import type { DashboardGateEntry } from "../api/types.js";

interface GatesPanelProps {
  gates: DashboardGateEntry[];
}

const layerColors: Record<string, string> = {
  automated: "text-[var(--accent-blue)]",
  security: "text-[var(--accent-purple)]",
  quality: "text-[var(--accent-yellow)]",
  "tree-check": "text-[var(--text-secondary)]",
  human: "text-[var(--accent-green)]",
};

function timeAgo(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function GateRow({ gate }: { gate: DashboardGateEntry }) {
  const layerColor = layerColors[gate.layer] ?? "text-[var(--text-muted)]";
  const failReason =
    !gate.pass && gate.issues.length > 0
      ? (gate.issues[0]?.note ?? gate.issues[0]?.rule ?? "unknown")
      : null;

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--bg-tertiary)]/50 last:border-0">
      <span
        className={`text-xs font-bold mt-0.5 ${gate.pass ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}
      >
        {gate.pass ? "\u2713" : "\u2717"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-primary)] truncate">{gate.taskName}</span>
          <span className={`text-xs ${layerColor}`}>{gate.layer}</span>
        </div>
        {failReason && (
          <p className="text-xs text-[var(--accent-red)]/80 truncate mt-0.5">{failReason}</p>
        )}
      </div>
      <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
        {timeAgo(gate.timestamp)}
      </span>
    </div>
  );
}

export function GatesPanel({ gates }: GatesPanelProps) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 overflow-auto h-full">
      <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
        Gate History
      </h2>
      {gates.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No gate results yet</p>
      ) : (
        <div>
          {gates.map((g, i) => (
            <GateRow key={`${g.taskId}-${g.layer}-${i}`} gate={g} />
          ))}
        </div>
      )}
    </div>
  );
}

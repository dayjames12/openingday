import type { DashboardCosts } from "../api/types.js";

interface CostsPanelProps {
  costs: DashboardCosts;
}

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-[var(--bg-tertiary)] rounded p-2.5">
      <p className="text-xs text-[var(--text-muted)] mb-0.5">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

export function CostsPanel({ costs }: CostsPanelProps) {
  const categoryEntries = Object.entries(costs.spendByCategory);
  const maxCategorySpend =
    categoryEntries.length > 0 ? Math.max(...categoryEntries.map(([, v]) => v)) : 0;

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 overflow-auto h-full">
      <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
        Cost & Metrics
      </h2>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricCard
          label="Spent"
          value={`$${costs.totalSpentUsd.toFixed(2)}`}
          sub={`of $${costs.projectBudgetUsd.toFixed(2)}`}
          color="text-[var(--text-primary)]"
        />
        <MetricCard
          label="Projected"
          value={`$${costs.projectedTotalUsd.toFixed(2)}`}
          sub={costs.projectedTotalUsd > costs.projectBudgetUsd ? "over budget" : "within budget"}
          color={
            costs.projectedTotalUsd > costs.projectBudgetUsd
              ? "text-[var(--accent-red)]"
              : "text-[var(--accent-green)]"
          }
        />
        <MetricCard
          label="Gate Pass Rate"
          value={`${costs.gatePassRate.toFixed(0)}%`}
          color={
            costs.gatePassRate >= 80
              ? "text-[var(--accent-green)]"
              : costs.gatePassRate >= 50
                ? "text-[var(--accent-yellow)]"
                : "text-[var(--accent-red)]"
          }
        />
        <MetricCard
          label="Budget Used"
          value={`${costs.percentUsed.toFixed(1)}%`}
          color={
            costs.percentUsed > 90
              ? "text-[var(--accent-red)]"
              : costs.percentUsed > 70
                ? "text-[var(--accent-yellow)]"
                : "text-[var(--text-primary)]"
          }
        />
      </div>

      {categoryEntries.length > 0 && (
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1.5">Spend by Milestone</p>
          <div className="space-y-1.5">
            {categoryEntries.map(([name, amount]) => (
              <div key={name}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-[var(--text-secondary)] truncate">{name}</span>
                  <span className="text-[var(--text-muted)] tabular-nums">
                    ${amount.toFixed(3)}
                  </span>
                </div>
                <div className="h-1 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-blue)] rounded-full transition-all duration-500"
                    style={{
                      width: maxCategorySpend > 0 ? `${(amount / maxCategorySpend) * 100}%` : "0%",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

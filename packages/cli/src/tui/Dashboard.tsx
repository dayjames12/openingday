import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { DiskStorage, getAllTasks } from "@openingday/core";
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  GateResult,
} from "@openingday/core";
import { WorkTreeView } from "./WorkTreeView.js";
import { WorkersView } from "./WorkersView.js";
import { GatesView } from "./GatesView.js";
import { CostsView } from "./CostsView.js";

interface DashboardState {
  config: ProjectConfig | null;
  state: ProjectState | null;
  workTree: WorkTree | null;
  codeTree: CodeTree | null;
  gateResults: Map<string, GateResult[]>;
  error: string | null;
}

function ProgressBar({
  pct,
  width = 10,
}: {
  pct: number;
  width?: number;
}): React.ReactElement {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return (
    <Text>
      <Text color="green">{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>
    </Text>
  );
}

export function Dashboard(): React.ReactElement {
  const [data, setData] = useState<DashboardState>({
    config: null,
    state: null,
    workTree: null,
    codeTree: null,
    gateResults: new Map(),
    error: null,
  });

  useEffect(() => {
    const storage = new DiskStorage(".openingday");

    async function load(): Promise<void> {
      try {
        const exists = await storage.exists();
        if (!exists) {
          setData((prev) => ({
            ...prev,
            error: "No project found. Run 'openingday new' to get started.",
          }));
          return;
        }

        const config = await storage.readProjectConfig();
        const state = await storage.readProjectState();
        const workTree = await storage.readWorkTree();
        const codeTree = await storage.readCodeTree();

        // Load gate results for all tasks
        const allTasks = getAllTasks(workTree);
        const gateResults = new Map<string, GateResult[]>();
        for (const task of allTasks) {
          const results = await storage.readGateResults(task.id);
          if (results.length > 0) {
            gateResults.set(task.id, results);
          }
        }

        setData({ config, state, workTree, codeTree, gateResults, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setData((prev) => ({ ...prev, error: `Load error: ${message}` }));
      }
    }

    void load();
    const interval = setInterval(() => void load(), 2000);
    return () => clearInterval(interval);
  }, []);

  if (data.error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">{data.error}</Text>
      </Box>
    );
  }

  if (!data.config || !data.state || !data.workTree || !data.codeTree) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">Loading...</Text>
      </Box>
    );
  }

  const allTasks = getAllTasks(data.workTree);
  const completedTasks = allTasks.filter((t) => t.status === "complete").length;
  const totalTasks = allTasks.length;
  const completionPct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const totalSpend = allTasks.reduce((sum, t) => sum + t.tokenSpend, 0);
  const budgetUsd = data.config.budgets.project.usd;
  // Simplified: treat token spend as a proxy for USD (1000 tokens ~ $1)
  const spendUsd = totalSpend / 1000;
  const budgetPct = budgetUsd > 0 ? (spendUsd / budgetUsd) * 100 : 0;

  const statusColor =
    data.state.status === "running"
      ? "green"
      : data.state.status === "paused"
        ? "yellow"
        : data.state.status === "complete"
          ? "green"
          : data.state.status === "failed"
            ? "red"
            : "gray";

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box justifyContent="space-between">
        <Text>
          <Text bold color="yellow">
            {"  OpeningDay"}
          </Text>
          <Text color="gray"> — </Text>
          <Text>{data.config.name}</Text>
        </Text>
        <Text>
          <Text color={statusColor} bold>
            {data.state.status.toUpperCase()}
          </Text>
          <Text color="gray">{"    "}</Text>
          <Text>
            ${spendUsd.toFixed(2)} / ${budgetUsd.toFixed(2)}{" "}
          </Text>
          <ProgressBar pct={budgetPct} />
        </Text>
      </Box>

      {/* Separator */}
      <Text color="gray">
        {"─".repeat(79)}
      </Text>

      {/* Main layout: Left (work tree) | Right (workers) */}
      <Box>
        <Box flexDirection="column" width="50%">
          <WorkTreeView workTree={data.workTree} />
        </Box>
        <Box flexDirection="column" width={1}>
          <Text color="gray">│</Text>
        </Box>
        <Box flexDirection="column" width="50%">
          <WorkersView
            workTree={data.workTree}
            state={data.state}
            config={data.config}
          />
        </Box>
      </Box>

      {/* Separator */}
      <Text color="gray">
        {"─".repeat(39)}{"┼"}{"─".repeat(39)}
      </Text>

      {/* Bottom layout: Left (gates) | Right (costs) */}
      <Box>
        <Box flexDirection="column" width="50%">
          <GatesView
            workTree={data.workTree}
            gateResults={data.gateResults}
          />
        </Box>
        <Box flexDirection="column" width={1}>
          <Text color="gray">│</Text>
        </Box>
        <Box flexDirection="column" width="50%">
          <CostsView
            workTree={data.workTree}
            state={data.state}
            config={data.config}
            completionPct={completionPct}
          />
        </Box>
      </Box>
    </Box>
  );
}

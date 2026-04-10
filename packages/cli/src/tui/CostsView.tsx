import React from "react";
import { Box, Text } from "ink";
import { getAllTasks } from "@openingday/core";
import type { WorkTree, ProjectState, ProjectConfig } from "@openingday/core";

export function CostsView({
  workTree,
  state,
  config,
  completionPct,
}: {
  workTree: WorkTree;
  state: ProjectState;
  config: ProjectConfig;
  completionPct: number;
}): React.ReactElement {
  const allTasks = getAllTasks(workTree);
  // Use state.totalTokenSpend as the canonical spend value
  const totalSpend = state.totalTokenSpend || allTasks.reduce((sum, t) => sum + t.tokenSpend, 0);
  const spendUsd = totalSpend / 1000;
  const budgetUsd = config.budgets.project.usd;
  const budgetPct = budgetUsd > 0 ? (spendUsd / budgetUsd) * 100 : 0;

  // Estimate projected cost based on completion %
  const projected = completionPct > 0 ? (spendUsd / completionPct) * 100 : 0;

  // Pass rate
  const completedTasks = allTasks.filter((t) => t.status === "complete").length;
  const failedTasks = allTasks.filter((t) => t.status === "failed").length;
  const attemptedTasks = completedTasks + failedTasks;
  const passRate = attemptedTasks > 0 ? Math.round((completedTasks / attemptedTasks) * 100) : 100;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold> Cost &amp; Metrics</Text>
      <Text> </Text>
      <Text>
        <Text color="gray"> Spent: </Text>
        <Text color="cyan">${spendUsd.toFixed(2)}</Text>
      </Text>
      <Text>
        <Text color="gray"> Projected: </Text>
        <Text>~${projected.toFixed(0)}</Text>
      </Text>
      <Text>
        <Text color="gray"> Pass rate: </Text>
        <Text color={passRate >= 80 ? "green" : passRate >= 50 ? "yellow" : "red"}>
          {passRate}%
        </Text>
      </Text>
      <Text>
        <Text color="gray"> Budget: </Text>
        <Text color={budgetPct >= 90 ? "red" : budgetPct >= 70 ? "yellow" : "green"}>
          {budgetPct.toFixed(0)}% used
        </Text>
      </Text>
      <Text> </Text>
      <Text>
        <Text color="gray"> Tasks: </Text>
        <Text>
          {completedTasks}/{allTasks.length} done ({completionPct.toFixed(0)}%)
        </Text>
      </Text>
    </Box>
  );
}

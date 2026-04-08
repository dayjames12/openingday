import React from "react";
import { Box, Text } from "ink";
import { getAllTasks } from "@openingday/core";
import type { WorkTree, GateResult } from "@openingday/core";

interface FlatGateEntry {
  taskName: string;
  result: GateResult;
}

export function GatesView({
  workTree,
  gateResults,
}: {
  workTree: WorkTree;
  gateResults: Map<string, GateResult[]>;
}): React.ReactElement {
  // Flatten all gate results into a list sorted by timestamp (most recent first)
  const allTasks = getAllTasks(workTree);
  const taskNameMap = new Map<string, string>();
  for (const task of allTasks) {
    taskNameMap.set(task.id, task.name);
  }

  const entries: FlatGateEntry[] = [];
  for (const [taskId, results] of gateResults) {
    const taskName = taskNameMap.get(taskId) ?? taskId;
    for (const result of results) {
      entries.push({ taskName, result });
    }
  }

  // Sort by timestamp descending, take last 8
  entries.sort(
    (a, b) =>
      new Date(b.result.timestamp).getTime() -
      new Date(a.result.timestamp).getTime(),
  );
  const recent = entries.slice(0, 8);

  const passed = entries.filter((e) => e.result.pass).length;
  const failed = entries.filter((e) => !e.result.pass).length;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold>
        {" "}Gate History{" "}
        <Text color="gray">
          ({passed}p {failed}f)
        </Text>
      </Text>
      <Text> </Text>
      {recent.length === 0 ? (
        <Text color="gray"> No gate results yet</Text>
      ) : (
        recent.map((entry, i) => (
          <Text key={String(i)}>
            {entry.result.pass ? (
              <Text color="green">{"✓"}</Text>
            ) : (
              <Text color="red">{"✗"}</Text>
            )}
            <Text> {entry.taskName}</Text>
            <Text color="gray"> {entry.result.layer}</Text>
          </Text>
        ))
      )}
    </Box>
  );
}

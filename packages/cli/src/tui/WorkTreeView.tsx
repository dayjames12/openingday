import React from "react";
import { Box, Text } from "ink";
import { getAllTasks } from "@openingday/core";
import type { WorkTree, WorkMilestone, WorkSlice, WorkTask } from "@openingday/core";

function taskIcon(status: WorkTask["status"]): React.ReactElement {
  switch (status) {
    case "complete":
      return <Text color="green">{"✓"}</Text>;
    case "in_progress":
      return <Text color="blue">{"⟳"}</Text>;
    case "failed":
      return <Text color="red">{"✗"}</Text>;
    case "paused":
      return <Text color="yellow">{"⏸"}</Text>;
    case "pending":
    default:
      return <Text color="gray">{"○"}</Text>;
  }
}

function sliceProgress(slice: WorkSlice): React.ReactElement {
  const total = slice.tasks.length;
  const done = slice.tasks.filter((t) => t.status === "complete").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barWidth = 4;
  const filled = Math.round((pct / 100) * barWidth);
  const empty = barWidth - filled;

  return (
    <Text>
      <Text color="green">{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>
      <Text color="gray"> {pct}%</Text>
    </Text>
  );
}

function milestoneProgress(milestone: WorkMilestone): number {
  const tasks = milestone.slices.flatMap((s) => s.tasks);
  const done = tasks.filter((t) => t.status === "complete").length;
  return tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
}

function TaskRow({ task }: { task: WorkTask }): React.ReactElement {
  const costStr = task.tokenSpend > 0 ? `$${(task.tokenSpend / 1000).toFixed(2)}` : "";
  const workerStr = task.worker ? `←${task.worker.slice(0, 4)}` : "";

  return (
    <Box>
      <Text>{"    "}</Text>
      {taskIcon(task.status)}
      <Text> {task.name}</Text>
      {costStr ? <Text color="gray"> {costStr}</Text> : null}
      {workerStr ? <Text color="blue"> {workerStr}</Text> : null}
    </Box>
  );
}

export function WorkTreeView({ workTree }: { workTree: WorkTree }): React.ReactElement {
  const allTasks = getAllTasks(workTree);
  if (allTasks.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text bold> Work Tree</Text>
        <Text color="gray"> (empty)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold> Work Tree</Text>
      {workTree.milestones.map((milestone) => (
        <Box key={milestone.id} flexDirection="column">
          <Text>
            <Text bold>
              {" "}
              {"▼"} {milestone.name}
            </Text>
            <Text color="gray"> {milestoneProgress(milestone)}%</Text>
          </Text>
          {milestone.slices.map((slice) => (
            <Box key={slice.id} flexDirection="column">
              <Text>
                <Text bold>
                  {"   ▼ "}
                  {slice.name}
                </Text>
                {"  "}
                {sliceProgress(slice)}
              </Text>
              {slice.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

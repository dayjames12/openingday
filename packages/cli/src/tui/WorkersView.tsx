import React from "react";
import { Box, Text } from "ink";
import { getAllTasks } from "@openingday/core";
import type { WorkTree, ProjectState, ProjectConfig } from "@openingday/core";

export function WorkersView({
  workTree,
  state,
  config,
}: {
  workTree: WorkTree;
  state: ProjectState;
  config: ProjectConfig;
}): React.ReactElement {
  const allTasks = getAllTasks(workTree);
  const activeTasks = allTasks.filter((t) => t.status === "in_progress");
  const maxWorkers = config.limits.maxConcurrentWorkers;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold>
        {" "}Active Workers ({activeTasks.length}/{maxWorkers})
      </Text>
      <Text> </Text>
      {activeTasks.length === 0 ? (
        <Text color="gray"> No active workers</Text>
      ) : (
        activeTasks.map((task) => (
          <Box key={task.id} flexDirection="column">
            <Text>
              <Text color="green">{"●"}</Text>
              <Text> {task.worker ? task.worker.slice(0, 10) : task.id}</Text>
              <Text color="gray"> {task.name}</Text>
            </Text>
            <Text color="gray">
              {"   tokens: "}
              {(task.tokenSpend / 1000).toFixed(1)}k
            </Text>
          </Box>
        ))
      )}
      {/* Show idle slots */}
      {Array.from({ length: Math.max(0, maxWorkers - activeTasks.length) }).map(
        (_, i) => (
          <Text key={`idle-${String(i)}`} color="gray">
            {"○"} slot-{activeTasks.length + i + 1}  idle
          </Text>
        ),
      )}
      <Text> </Text>
      <Text color="gray">
        {" "}Total spawned: {state.totalWorkersSpawned}
      </Text>
    </Box>
  );
}

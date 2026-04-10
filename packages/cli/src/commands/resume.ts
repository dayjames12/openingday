import type { Command } from "commander";
import chalk from "chalk";
import { DiskStorage, transition } from "@openingday/core";

export function registerResume(program: Command): void {
  program
    .command("resume")
    .description("Resume a paused orchestration loop")
    .action(async () => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(chalk.red("No project found. Run `openingday init --from <spec>` first."));
        return;
      }

      const state = await storage.readProjectState();
      if (state.status !== "paused") {
        console.log(chalk.red(`Cannot resume from state "${state.status}". Must be "paused".`));
        return;
      }

      const updated = transition(state, "running");
      await storage.writeProjectState(updated);
      console.log(chalk.green("Project resumed."));
    });
}

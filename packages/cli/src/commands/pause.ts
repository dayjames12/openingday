import type { Command } from "commander";
import chalk from "chalk";
import { DiskStorage, transition } from "@openingday/core";

export function registerPause(program: Command): void {
  program
    .command("pause")
    .description("Pause the orchestration loop")
    .action(async () => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(
          chalk.red("No project found. Run `openingday init --from <spec>` first."),
        );
        return;
      }

      const state = await storage.readProjectState();
      if (state.status !== "running") {
        console.log(
          chalk.red(`Cannot pause from state "${state.status}". Must be "running".`),
        );
        return;
      }

      const updated = transition(state, "paused");
      await storage.writeProjectState(updated);
      console.log(chalk.yellow("Project paused."));
    });
}

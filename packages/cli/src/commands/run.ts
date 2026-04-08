import type { Command } from "commander";
import chalk from "chalk";
import {
  DiskStorage,
  transition,
  Orchestrator,
  spawnAgent,
} from "@openingday/core";

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Start or resume the orchestration loop")
    .option("--step", "Run one cycle and exit")
    .option("--dry-run", "Print what would be dispatched without running")
    .action(async (opts: { step?: boolean; dryRun?: boolean }) => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(
          chalk.red("No project found. Run `openingday init --from <spec>` first."),
        );
        return;
      }

      let state = await storage.readProjectState();

      // Transition based on current state
      if (state.status === "idle") {
        state = transition(state, "seeding");
        state = transition(state, "running");
        await storage.writeProjectState(state);
        console.log(chalk.green("Transitioned: idle -> seeding -> running"));
      } else if (state.status === "paused") {
        state = transition(state, "running");
        await storage.writeProjectState(state);
        console.log(chalk.green("Transitioned: paused -> running"));
      } else if (state.status === "running") {
        console.log(chalk.yellow("Already running."));
      } else {
        console.log(
          chalk.red(`Cannot run from state "${state.status}".`),
        );
        return;
      }

      if (opts.dryRun) {
        console.log(chalk.gray("Dry run mode — no agents will be spawned."));
        return;
      }

      const orchestrator = new Orchestrator(storage, spawnAgent);

      // Handle SIGINT for graceful shutdown
      let shuttingDown = false;
      const onSigint = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(chalk.yellow("\nGraceful shutdown requested..."));
        const currentState = await storage.readProjectState();
        if (currentState.status === "running") {
          const paused = transition(currentState, "paused");
          await storage.writeProjectState(paused);
          console.log(chalk.yellow("State transitioned to paused."));
        }
        process.exit(0);
      };
      process.on("SIGINT", onSigint);

      try {
        if (opts.step) {
          // Single cycle mode
          const result = await orchestrator.runOneCycle();
          console.log(
            chalk.cyan(
              `Cycle: dispatched=${result.dispatched} completed=${result.completed} failed=${result.failed}`,
            ),
          );
          if (result.isComplete) console.log(chalk.green("Project complete!"));
          if (result.isPaused) console.log(chalk.yellow(`Paused. ${result.error ?? ""}`));
          return;
        }

        // Continuous loop
        while (!shuttingDown) {
          const result = await orchestrator.runOneCycle();
          console.log(
            chalk.cyan(
              `Cycle: dispatched=${result.dispatched} completed=${result.completed} failed=${result.failed}`,
            ),
          );

          if (result.isComplete) {
            console.log(chalk.green("Project complete!"));
            break;
          }
          if (result.isPaused) {
            console.log(chalk.yellow(`Paused. ${result.error ?? ""}`));
            break;
          }

          // Pause between cycles when nothing was dispatched
          if (result.dispatched === 0) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    });
}

import type { Command } from "commander";
import chalk from "chalk";
import { join, resolve } from "node:path";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { DiskStorage, transition, Orchestrator, spawnAgent } from "@openingday/core";

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Start or resume the orchestration loop")
    .option("--step", "Run one cycle and exit")
    .option("--dry-run", "Print what would be dispatched without running")
    .action(async (opts: { step?: boolean; dryRun?: boolean }) => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(chalk.red("No project found. Run `openingday init --from <spec>` first."));
        return;
      }

      const stateDir = resolve(process.cwd(), ".openingday");
      const pidFile = join(stateDir, "run.pid");

      let state = await storage.readProjectState();

      // Stale process detection: if state says "running", check PID file
      if (state.status === "running") {
        let alreadyRunning = false;
        try {
          const pid = parseInt(await readFile(pidFile, "utf-8"));
          process.kill(pid, 0); // throws if process doesn't exist
          alreadyRunning = true;
          console.error(chalk.yellow(`Already running (PID ${pid}).`));
          process.exit(1);
        } catch {
          if (!alreadyRunning) {
            // PID file stale or missing — process died, safe to reclaim
            await unlink(pidFile).catch(() => {});
            console.log(chalk.yellow("Stale run detected. Reclaiming..."));
          }
        }
      }

      // Write PID file and register cleanup
      await writeFile(pidFile, String(process.pid));
      process.on("exit", () => {
        try {
          unlinkSync(pidFile);
        } catch {}
      });

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
        // Already running state but we passed PID check — continue
      } else {
        console.log(chalk.red(`Cannot run from state "${state.status}".`));
        return;
      }

      if (opts.dryRun) {
        console.log(chalk.gray("Dry run mode — no agents will be spawned."));
        return;
      }

      const orchestrator = new Orchestrator(storage, spawnAgent, {
        repoDir: process.cwd(),
      });

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
        let consecutiveErrors = 0;
        while (!shuttingDown) {
          try {
            const result = await orchestrator.runOneCycle();
            consecutiveErrors = 0;
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
          } catch (err) {
            consecutiveErrors++;
            console.error(chalk.red(`Cycle error (${consecutiveErrors}/3): ${err}`));
            if (consecutiveErrors >= 3) {
              console.error(chalk.red("3 consecutive cycle errors. Pausing."));
              const currentState = await storage.readProjectState();
              if (currentState.status === "running") {
                const paused = transition(currentState, "paused");
                await storage.writeProjectState(paused);
              }
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    });
}

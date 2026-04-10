import type { Command } from "commander";
import chalk from "chalk";
import {
  DiskStorage,
  getAllTasks,
  getProjectBudgetStatus,
  checkCircuitBreakers,
} from "@openingday/core";
import { statusIcon, formatProjectStatus } from "../utils/display.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show project status")
    .option("--cost", "Show detailed cost/budget info")
    .action(async (opts: { cost?: boolean }) => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(
          chalk.red("No project found. Run `openingday init --from <spec>` first."),
        );
        return;
      }

      const config = await storage.readProjectConfig();
      const state = await storage.readProjectState();
      const workTree = await storage.readWorkTree();

      console.log(chalk.bold(`Project: ${config.name}`));
      console.log(formatProjectStatus(state, state.totalTokenSpend));
      console.log();

      // Task summary
      const allTasks = getAllTasks(workTree);
      const completed = allTasks.filter((t) => t.status === "complete").length;
      const failed = allTasks.filter((t) => t.status === "failed").length;
      const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
      const pending = allTasks.filter((t) => t.status === "pending").length;
      const paused = allTasks.filter((t) => t.status === "paused").length;

      console.log(chalk.bold("Tasks:"));
      console.log(`  ${statusIcon("complete")} Completed:   ${chalk.green(String(completed))}`);
      console.log(`  ${statusIcon("in_progress")} In Progress: ${chalk.blue(String(inProgress))}`);
      console.log(`  ${statusIcon("pending")} Pending:     ${chalk.gray(String(pending))}`);
      console.log(`  ${statusIcon("paused")} Paused:      ${chalk.yellow(String(paused))}`);
      console.log(`  ${statusIcon("failed")} Failed:      ${chalk.red(String(failed))}`);
      console.log(`  Total: ${allTasks.length}`);

      if (failed > 0) {
        console.log(chalk.yellow("  Tip: Failed tasks may need higher budget. Edit .openingday/project.json budgets.perTask.usd"));
      }

      if (opts.cost) {
        console.log();
        const budget = getProjectBudgetStatus(state, config);
        const breakers = checkCircuitBreakers(workTree, state, config);

        console.log(chalk.bold("Budget:"));
        console.log(
          `  Spent: ${budget.totalSpent} / ${budget.projectBudget} (${budget.percentage.toFixed(1)}%)`,
        );
        if (budget.atWarning)
          console.log(chalk.yellow("  WARNING: Approaching budget limit"));
        if (budget.atLimit)
          console.log(chalk.red("  LIMIT: Budget exhausted"));
        if (breakers.reason)
          console.log(chalk.red(`  Circuit breaker: ${breakers.reason}`));
      }
    });
}

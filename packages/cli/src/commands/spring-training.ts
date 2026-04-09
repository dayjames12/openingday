import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import { DiskStorage } from "@openingday/core";
import { runSpringTraining } from "@openingday/core/spring-training/runner";
import { scanRepo as scanRepoMap } from "@openingday/core/scanner/scan";
import type { RepoMap } from "@openingday/core/scanner/types";

export function registerSpringTraining(program: Command): void {
  program
    .command("spring-training")
    .description("Run plan validation, contract generation, and execution simulation")
    .option("--spec <path>", "Path to specification file")
    .option("--skip-ai", "Skip AI contract generation (structural validation only)")
    .action(async (opts: { spec?: string; skipAi?: boolean }) => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(chalk.red("No project found. Run `openingday init` first."));
        return;
      }

      const config = await storage.readProjectConfig();

      // Read spec text
      let specText = "";
      const specPath = opts.spec ?? config.specPath;
      if (specPath && specPath !== "interactive") {
        try {
          specText = await readFile(resolve(specPath), "utf-8");
        } catch {
          console.log(chalk.yellow(`Could not read spec at ${specPath}`));
        }
      }

      // Read repo map
      let repoMap: RepoMap | null = null;
      try {
        repoMap = await storage.readRepoMap();
        if (!repoMap) {
          repoMap = await scanRepoMap(process.cwd(), "standard");
        }
      } catch {
        // No repo map available
      }

      console.log(chalk.gray("Running spring training..."));
      console.log();

      const result = await runSpringTraining(
        storage,
        specText,
        repoMap,
        process.cwd(),
        opts.skipAi,
      );

      // Display results
      if (result.blockers.length > 0) {
        console.log(chalk.red.bold("BLOCKERS:"));
        for (const b of result.blockers) {
          console.log(chalk.red(`  - ${b}`));
        }
        console.log();
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow.bold("WARNINGS:"));
        for (const w of result.warnings) {
          console.log(chalk.yellow(`  - ${w}`));
        }
        console.log();
      }

      if (result.contracts) {
        console.log(chalk.green("Contracts generated and saved."));
      }

      console.log(chalk.gray(`Execution order: ${result.executionOrder.length} tasks`));
      if (result.addedDependencies.length > 0) {
        console.log(chalk.cyan(`Added ${result.addedDependencies.length} missing dependencies`));
      }

      console.log();
      if (result.valid) {
        console.log(chalk.green.bold("Spring training PASSED"));
      } else {
        console.log(chalk.red.bold("Spring training FAILED — fix blockers before running"));
      }
    });
}

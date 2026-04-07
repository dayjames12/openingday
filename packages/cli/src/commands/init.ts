import type { Command } from "commander";
import chalk from "chalk";
import {
  DiskStorage,
  defaultConfig,
  createWorkTree,
  createCodeTree,
  createProjectState,
} from "@openingday/core";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize a new OpeningDay project")
    .requiredOption("--from <path>", "Path to specification file")
    .option("--name <name>", "Project name", "my-project")
    .action(async (opts: { from: string; name: string }) => {
      const storage = new DiskStorage(".openingday");
      if (await storage.exists()) {
        console.log(chalk.yellow("Project already initialized in .openingday/"));
        return;
      }

      await storage.initialize();
      const config = defaultConfig(opts.name, opts.from);
      await storage.writeProjectConfig(config);
      await storage.writeProjectState(createProjectState());
      await storage.writeWorkTree(createWorkTree());
      await storage.writeCodeTree(createCodeTree());

      console.log(
        chalk.green(`Initialized project "${opts.name}" in .openingday/`),
      );
      console.log(chalk.gray(`  Spec: ${opts.from}`));
    });
}

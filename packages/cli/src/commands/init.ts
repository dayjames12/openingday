import type { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  DiskStorage,
  defaultConfig,
  createWorkTree,
  createCodeTree,
  createProjectState,
  getAllTasks,
  seedFromSpec,
  scanRepo,
} from "@openingday/core";
import { scanRepo as scanRepoMap } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";
import { runSpringTraining } from "@openingday/core/spring-training/runner";
import type { RepoMap } from "@openingday/core/scanner/types";
import type { WorkTree, CodeTree } from "@openingday/core";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize a new OpeningDay project")
    .requiredOption("--from <path>", "Path to specification file or repo directory")
    .option("--name <name>", "Project name", "my-project")
    .option("--spec <specPath>", "Path to spec file (used with directory --from)")
    .action(async (opts: { from: string; name: string; spec?: string }) => {
      const storage = new DiskStorage(".openingday");
      if (await storage.exists()) {
        console.log(chalk.yellow("Project already initialized in .openingday/"));
        return;
      }

      await storage.initialize();
      await ensureGitignore(process.cwd());
      const config = defaultConfig(opts.name, opts.from);
      await storage.writeProjectConfig(config);
      await storage.writeProjectState(createProjectState());

      let workTree: WorkTree = createWorkTree();
      let codeTree: CodeTree = createCodeTree();
      let repoMap: RepoMap | null = null;

      const fromPath = resolve(opts.from);
      const fromStat = await stat(fromPath).catch(() => null);

      try {
        if (fromStat?.isFile() && fromPath.endsWith(".md")) {
          // --from points to a .md file: seed from spec
          console.log(chalk.gray("Seeding from spec..."));
          const specText = await readFile(fromPath, "utf-8");
          const result = await seedFromSpec(specText, opts.name, process.cwd());
          if (result) {
            workTree = result.workTree;
            codeTree = result.codeTree;
          } else {
            console.log(chalk.yellow("Seeder returned no result; using empty trees."));
          }
        } else if (fromStat?.isDirectory()) {
          // --from points to a directory: scan repo for code tree
          console.log(chalk.gray("Scanning repository..."));
          codeTree = await scanRepo(fromPath);
          repoMap = await scanRepoMap(fromPath, "standard");

          // If --spec provided, also seed work tree from spec
          if (opts.spec) {
            const specPath = resolve(opts.spec);
            console.log(chalk.gray("Seeding from spec..."));
            const specText = await readFile(specPath, "utf-8");
            const result = await seedFromSpec(specText, opts.name, process.cwd(), undefined, repoMap);
            if (result) {
              workTree = result.workTree;
              // Keep the scanned code tree (more accurate than AI-generated)
            } else {
              console.log(chalk.yellow("Seeder returned no result; using empty work tree."));
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`Seeding failed: ${message}`));
        console.log(chalk.gray("Falling back to empty trees."));
        workTree = createWorkTree();
        codeTree = createCodeTree();
      }

      await storage.writeWorkTree(workTree);
      await storage.writeCodeTree(codeTree);
      if (repoMap) await storage.writeRepoMap(repoMap);

      // Run spring training
      if (workTree.milestones.length > 0) {
        console.log(chalk.gray("Running spring training..."));
        try {
          let specText = "";
          if (fromStat?.isFile() && fromPath.endsWith(".md")) {
            specText = await readFile(fromPath, "utf-8");
          } else if (opts.spec) {
            specText = await readFile(resolve(opts.spec), "utf-8");
          }
          const stResult = await runSpringTraining(storage, specText, repoMap, process.cwd());
          if (stResult.blockers.length > 0) {
            console.log(chalk.yellow(`  Spring training blockers: ${stResult.blockers.length}`));
            for (const b of stResult.blockers) {
              console.log(chalk.yellow(`    - ${b}`));
            }
          }
          if (stResult.warnings.length > 0) {
            console.log(chalk.gray(`  Spring training warnings: ${stResult.warnings.length}`));
          }
          if (stResult.contracts) {
            console.log(chalk.gray("  Contracts generated."));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(chalk.yellow(`  Spring training failed: ${msg}`));
        }
      }

      console.log(
        chalk.green(`Initialized project "${opts.name}" in .openingday/`),
      );
      console.log(chalk.gray(`  Spec: ${opts.from}`));

      // Print seeding summary
      const milestoneCount = workTree.milestones.length;
      const taskCount = getAllTasks(workTree).length;
      const fileCount = codeTree.modules.reduce((n, m) => n + m.files.length, 0);
      console.log(chalk.gray(`  Milestones: ${milestoneCount}`));
      console.log(chalk.gray(`  Tasks: ${taskCount}`));
      console.log(chalk.gray(`  Files: ${fileCount}`));
    });
}

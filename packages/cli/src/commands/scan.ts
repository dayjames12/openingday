import type { Command } from "commander";
import chalk from "chalk";
import { DiskStorage } from "@openingday/core";
import { scanRepo } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";
import type { ScanDepth } from "@openingday/core/scanner/types";

export function registerScan(program: Command): void {
  program
    .command("scan")
    .description("Scan repo and update repo map")
    .option("--depth <depth>", "Scan depth: lite, standard, deep", "standard")
    .action(async (opts: { depth: string }) => {
      const depth = opts.depth as ScanDepth;
      const storage = new DiskStorage(".openingday");

      await ensureGitignore(process.cwd());

      console.log(chalk.yellow(`Scanning (${depth})...`));
      const map = await scanRepo(process.cwd(), depth);
      await storage.writeRepoMap(map);

      const totalFiles = map.modules.reduce((sum, m) => sum + m.fc, 0);
      console.log(chalk.green(`Done: ${map.modules.length} modules, ${totalFiles} files`));
      console.log(chalk.gray(`  pm: ${map.env.pm} | test: ${map.env.test} | lint: ${map.env.lint} | ts: ${map.env.ts}`));
      if (map.env.monorepo) console.log(chalk.gray(`  monorepo: ${map.env.workspaces.join(", ")}`));
      if (map.env.infra !== "none") console.log(chalk.gray(`  infra: ${map.env.infra}`));
    });
}

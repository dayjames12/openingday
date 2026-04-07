import type { Command } from "commander";
import chalk from "chalk";
import { DiskStorage } from "@openingday/core";
import { formatWorkTree, formatCodeTree } from "../utils/display.js";

export function registerTree(program: Command): void {
  program
    .command("tree")
    .description("Print work tree (or code tree with --code)")
    .option("--code", "Print the code tree instead of the work tree")
    .action(async (opts: { code?: boolean }) => {
      const storage = new DiskStorage(".openingday");
      if (!(await storage.exists())) {
        console.log(
          chalk.red("No project found. Run `openingday init --from <spec>` first."),
        );
        return;
      }

      if (opts.code) {
        const codeTree = await storage.readCodeTree();
        console.log(formatCodeTree(codeTree));
      } else {
        const workTree = await storage.readWorkTree();
        console.log(formatWorkTree(workTree));
      }
    });
}

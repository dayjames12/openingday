import type { Command } from "commander";
import { basename, resolve } from "node:path";
import chalk from "chalk";
import { input, select, confirm } from "@inquirer/prompts";
import {
  DiskStorage,
  defaultConfig,
  createWorkTree,
  createCodeTree,
  createProjectState,
  getAllTasks,
  seedFromSpec,
} from "@openingday/core";
import { scanRepo as scanRepoMap } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";
import type { RepoMap } from "@openingday/core/scanner/types";
import type { WorkTree, CodeTree } from "@openingday/core";
import { STACK_PRESETS } from "../presets/stacks.js";
import type { StackPreset } from "../presets/stacks.js";
import { formatWorkTree } from "../utils/display.js";
import { printBanner } from "../utils/banner.js";

type ScaleChoice = "small" | "medium" | "large";

const SCALE_LABELS: Record<ScaleChoice, string> = {
  small: "Small — personal project or MVP",
  medium: "Medium — startup, ~10k users",
  large: "Large — production, 100k+ users",
};

/**
 * Assemble the user's answers into a rich spec string for the seeder.
 */
function buildSpecFromAnswers(answers: {
  description: string;
  preset: StackPreset | null;
  customStack: string | null;
  scale: ScaleChoice;
  requirements: string;
}): string {
  const lines: string[] = [];

  lines.push(`# Project Specification`);
  lines.push("");
  lines.push(`## What We're Building`);
  lines.push("");
  lines.push(answers.description);
  lines.push("");

  lines.push(`## Tech Stack`);
  lines.push("");

  if (answers.preset) {
    lines.push(`**Preset:** ${answers.preset.name}`);
    lines.push("");
    lines.push(`**Technologies:**`);
    for (const tech of answers.preset.technologies) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
    lines.push(`**Patterns:**`);
    for (const pattern of answers.preset.patterns) {
      lines.push(`- ${pattern}`);
    }
  } else if (answers.customStack) {
    lines.push(answers.customStack);
  }

  lines.push("");
  lines.push(`## Scale`);
  lines.push("");
  lines.push(SCALE_LABELS[answers.scale] ?? answers.scale);
  lines.push("");

  if (answers.requirements.trim()) {
    lines.push(`## Additional Requirements`);
    lines.push("");
    lines.push(answers.requirements);
    lines.push("");
  }

  return lines.join("\n");
}

export function registerNew(program: Command): void {
  program
    .command("new")
    .description("Create a new OpeningDay project (interactive)")
    .action(async () => {
      const storage = new DiskStorage(".openingday");
      if (await storage.exists()) {
        console.log(
          chalk.yellow(
            "A project already exists in .openingday/. Delete it first or use a different directory.",
          ),
        );
        return;
      }

      printBanner();

      // Step 1: What are you building?
      const description = await input({
        message: "What are you building?",
        validate: (val) => (val.trim() ? true : "Please describe your project"),
      });

      // Step 2: Tech stack selection
      const stackChoices = [
        ...STACK_PRESETS.map((preset) => ({
          name: `${chalk.bold(preset.name)} — ${preset.description}`,
          value: preset.name,
        })),
        {
          name: `${chalk.bold("Custom")} — describe your own stack`,
          value: "custom",
        },
      ];

      const stackChoice = await select({
        message: "Tech stack?",
        choices: stackChoices,
      });

      let selectedPreset: StackPreset | null = null;
      let customStack: string | null = null;

      if (stackChoice === "custom") {
        customStack = await input({
          message:
            "Describe your tech stack (languages, frameworks, databases, etc.):",
          validate: (val) =>
            val.trim() ? true : "Please describe your stack",
        });
      } else {
        selectedPreset =
          STACK_PRESETS.find((p) => p.name === stackChoice) ?? null;
      }

      // Step 3: Scale
      const scale = await select<ScaleChoice>({
        message: "Scale?",
        choices: [
          {
            name: SCALE_LABELS.small,
            value: "small" as ScaleChoice,
          },
          {
            name: SCALE_LABELS.medium,
            value: "medium" as ScaleChoice,
          },
          {
            name: SCALE_LABELS.large,
            value: "large" as ScaleChoice,
          },
        ],
      });

      // Step 4: Additional requirements
      const requirements = await input({
        message: "Any specific requirements? (optional, press Enter to skip)",
        default: "",
      });

      // Step 5: Project name and directory
      const defaultName = basename(process.cwd());
      const projectName = await input({
        message: "Project name?",
        default: defaultName,
        validate: (val) => (val.trim() ? true : "Name required"),
      });

      const projectDir = resolve(process.cwd());
      console.log();
      console.log(chalk.gray(`Directory: ${projectDir}`));
      console.log();

      const proceed = await confirm({
        message: "Generate project plan?",
        default: true,
      });

      if (!proceed) {
        console.log(chalk.gray("Cancelled."));
        return;
      }

      // Step 6: Generate plan
      console.log();
      const spinner = ["   ", ".  ", ".. ", "..."];
      let spinIdx = 0;
      const spinnerInterval = setInterval(() => {
        process.stdout.write(
          `\r${chalk.yellow("Generating plan")}${spinner[spinIdx % spinner.length]}`,
        );
        spinIdx++;
      }, 300);

      const specText = buildSpecFromAnswers({
        description,
        preset: selectedPreset,
        customStack,
        scale,
        requirements,
      });

      let workTree: WorkTree = createWorkTree();
      let codeTree: CodeTree = createCodeTree();

      // Scan existing repo for landscape context
      let repoMap: RepoMap | null = null;
      try {
        repoMap = await scanRepoMap(process.cwd(), "standard");
      } catch {
        // No existing files to scan — that's fine
      }

      try {
        const result = await seedFromSpec(
          specText,
          projectName,
          process.cwd(),
          undefined,
          repoMap,
        );
        if (result) {
          workTree = result.workTree;
          codeTree = result.codeTree;
        } else {
          clearInterval(spinnerInterval);
          process.stdout.write("\r");
          console.log(
            chalk.yellow("Seeder returned no result; using empty trees."),
          );
        }
      } catch (err) {
        clearInterval(spinnerInterval);
        process.stdout.write("\r");
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`Seeding failed: ${message}`));
        console.log(chalk.gray("Falling back to empty trees."));
        workTree = createWorkTree();
        codeTree = createCodeTree();
      }

      clearInterval(spinnerInterval);
      process.stdout.write("\r" + " ".repeat(40) + "\r");

      // Step 7: Summary
      const milestoneCount = workTree.milestones.length;
      const taskCount = getAllTasks(workTree).length;
      const fileCount = codeTree.modules.reduce(
        (n, m) => n + m.files.length,
        0,
      );

      console.log();
      console.log(chalk.bold("Plan Summary"));
      console.log(chalk.gray("  Milestones: ") + chalk.cyan(String(milestoneCount)));
      console.log(chalk.gray("  Tasks:      ") + chalk.cyan(String(taskCount)));
      console.log(chalk.gray("  Files:      ") + chalk.cyan(String(fileCount)));
      console.log();

      // Step 8: Review?
      if (milestoneCount > 0) {
        const review = await confirm({
          message: "Review the plan?",
          default: true,
        });

        if (review) {
          console.log();
          console.log(formatWorkTree(workTree));
          console.log();
        }
      }

      const save = await confirm({
        message: "Save and initialize project?",
        default: true,
      });

      if (!save) {
        console.log(chalk.gray("Cancelled."));
        return;
      }

      // Step 9: Write to .openingday/
      await storage.initialize();
      await ensureGitignore(process.cwd());
      const config = defaultConfig(projectName, "interactive");
      await storage.writeProjectConfig(config);
      await storage.writeProjectState(createProjectState());
      await storage.writeWorkTree(workTree);
      await storage.writeCodeTree(codeTree);
      if (repoMap) await storage.writeRepoMap(repoMap);

      console.log();
      console.log(
        chalk.green(`Project "${projectName}" initialized in .openingday/`),
      );
      console.log(
        chalk.gray("Run ") +
          chalk.bold("openingday run") +
          chalk.gray(" to start building."),
      );
    });
}

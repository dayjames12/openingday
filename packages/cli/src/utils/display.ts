import chalk from "chalk";
import { getAllTasks } from "@openingday/core";
import type {
  TaskStatus,
  ProjectState,
  WorkTree,
  CodeTree,
} from "@openingday/core";

// === Status Icons ===

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "○",
  in_progress: "⟳",
  complete: "✓",
  failed: "✗",
  paused: "⏸",
};

export function statusIcon(status: TaskStatus): string {
  switch (status) {
    case "pending":
      return chalk.gray(STATUS_ICONS[status]);
    case "in_progress":
      return chalk.blue(STATUS_ICONS[status]);
    case "complete":
      return chalk.green(STATUS_ICONS[status]);
    case "failed":
      return chalk.red(STATUS_ICONS[status]);
    case "paused":
      return chalk.yellow(STATUS_ICONS[status]);
  }
}

// === Project Status Colors ===

export function colorStatus(status: string): string {
  switch (status) {
    case "idle":
      return chalk.gray(status);
    case "seeding":
      return chalk.yellow(status);
    case "running":
      return chalk.green(status);
    case "paused":
      return chalk.yellow(status);
    case "complete":
      return chalk.green(status);
    case "failed":
      return chalk.red(status);
    default:
      return status;
  }
}

// === Format Project Status ===

export function formatProjectStatus(
  state: ProjectState,
  tokenSpend: number,
): string {
  const lines: string[] = [];
  lines.push(`Status:  ${colorStatus(state.status)}`);
  lines.push(`Spend:   ${chalk.cyan(String(tokenSpend))} tokens`);
  lines.push(`Workers: ${chalk.cyan(String(state.totalWorkersSpawned))} spawned`);
  if (state.pausedAt) {
    lines.push(`Paused:  ${chalk.yellow(state.pausedAt)}`);
  }
  return lines.join("\n");
}

// === Format Work Tree ===

export function formatWorkTree(tree: WorkTree): string {
  const lines: string[] = [];
  const allTasks = getAllTasks(tree);
  const completed = allTasks.filter((t) => t.status === "complete").length;

  lines.push(
    chalk.bold("Work Tree") +
      chalk.gray(` (${completed}/${allTasks.length} tasks complete)`),
  );

  if (tree.milestones.length === 0) {
    lines.push(chalk.gray("  (empty)"));
    return lines.join("\n");
  }

  for (const milestone of tree.milestones) {
    const mTasks = milestone.slices.flatMap((s) => s.tasks);
    const mComplete = mTasks.filter((t) => t.status === "complete").length;

    lines.push("");
    lines.push(
      chalk.bold.underline(milestone.name) +
        chalk.gray(` [${mComplete}/${mTasks.length}]`),
    );
    if (milestone.description) {
      lines.push(chalk.gray(`  ${milestone.description}`));
    }

    for (const slice of milestone.slices) {
      const sTasks = slice.tasks;
      const sComplete = sTasks.filter((t) => t.status === "complete").length;

      lines.push(
        `  ${chalk.bold(slice.name)}` +
          chalk.gray(` [${sComplete}/${sTasks.length}]`),
      );

      for (const task of sTasks) {
        const icon = statusIcon(task.status);
        lines.push(`    ${icon} ${task.name} ${chalk.gray(`(${task.id})`)}`);
      }
    }
  }

  return lines.join("\n");
}

// === Format Code Tree ===

export function formatCodeTree(tree: CodeTree): string {
  const lines: string[] = [];
  const totalFiles = tree.modules.reduce((n, m) => n + m.files.length, 0);

  lines.push(
    chalk.bold("Code Tree") +
      chalk.gray(
        ` (${tree.modules.length} modules, ${totalFiles} files)`,
      ),
  );

  if (tree.modules.length === 0) {
    lines.push(chalk.gray("  (empty)"));
    return lines.join("\n");
  }

  for (const mod of tree.modules) {
    lines.push("");
    lines.push(
      chalk.bold.underline(mod.path) +
        chalk.gray(` (${mod.files.length} files)`),
    );
    if (mod.description) {
      lines.push(chalk.gray(`  ${mod.description}`));
    }

    for (const file of mod.files) {
      lines.push(`  ${chalk.cyan(file.path)}`);
      for (const exp of file.exports) {
        lines.push(
          `    ${chalk.green("export")} ${exp.name} ${chalk.gray(exp.signature)}`,
        );
      }
    }
  }

  return lines.join("\n");
}

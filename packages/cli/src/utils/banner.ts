import chalk from "chalk";

const VERSION = "0.1.0";

export function printBanner(): void {
  const y = chalk.yellow;

  console.log();
  console.log(y("      ⚾"));
  console.log(y("   ___                 _           ___"));
  console.log(y("  / _ \\ _ __  ___ _ _ (_)_ _  __ _|   \\ __ _ _  _"));
  console.log(y(" | (_) | '_ \\/ -_) ' \\| | ' \\/ _` | |) / _` | || |"));
  console.log(y("  \\___/| .__/\\___|_||_|_|_||_\\__, |___/\\__,_|\\_, |"));
  console.log(y("       |_|                   |___/           |__/"));
  console.log();
  console.log(chalk.gray("  Spec in. Code out.") + chalk.gray.dim(`  v${VERSION}`));
  console.log();
}

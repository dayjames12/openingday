#!/usr/bin/env node

import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerNew } from "./commands/new.js";
import { registerStatus } from "./commands/status.js";
import { registerTree } from "./commands/tree.js";
import { registerRun } from "./commands/run.js";
import { registerPause } from "./commands/pause.js";
import { registerResume } from "./commands/resume.js";
import { registerKill } from "./commands/kill.js";
import { registerDashboard } from "./commands/dashboard.js";
import { registerWatch } from "./commands/watch.js";
import { registerScan } from "./commands/scan.js";
import { registerSpringTraining } from "./commands/spring-training.js";
import { registerMarinSpecial } from "./commands/marin-special.js";
import { printBanner } from "./utils/banner.js";

const program = new Command();

program
  .name("openingday")
  .description("AI-orchestrated software development")
  .version("0.1.0")
  .addHelpText(
    "after",
    "\nGetting started:\n  $ openingday new       Create a new project interactively\n  $ openingday watch     Live terminal dashboard\n",
  );

registerNew(program);
registerInit(program);
registerStatus(program);
registerTree(program);
registerRun(program);
registerPause(program);
registerResume(program);
registerKill(program);
registerDashboard(program);
registerWatch(program);
registerScan(program);
registerSpringTraining(program);
registerMarinSpecial(program);

// Default to banner + help when no command given
if (process.argv.length <= 2) {
  printBanner();
  program.outputHelp();
} else {
  program.parse();
}

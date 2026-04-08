#!/usr/bin/env node

import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerStatus } from "./commands/status.js";
import { registerTree } from "./commands/tree.js";
import { registerRun } from "./commands/run.js";
import { registerPause } from "./commands/pause.js";
import { registerResume } from "./commands/resume.js";
import { registerKill } from "./commands/kill.js";

const program = new Command();

program
  .name("openingday")
  .description("AI-orchestrated software development")
  .version("0.1.0");

registerInit(program);
registerStatus(program);
registerTree(program);
registerRun(program);
registerPause(program);
registerResume(program);
registerKill(program);

program.parse();

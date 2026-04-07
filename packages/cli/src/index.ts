#!/usr/bin/env node

import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerStatus } from "./commands/status.js";
import { registerTree } from "./commands/tree.js";

const program = new Command();

program
  .name("openingday")
  .description("AI-orchestrated software development")
  .version("0.1.0");

registerInit(program);
registerStatus(program);
registerTree(program);

program.parse();

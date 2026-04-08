import type { Command } from "commander";
import React from "react";
import { render } from "ink";
import { Dashboard } from "../tui/Dashboard.js";

export function registerWatch(program: Command): void {
  program
    .command("watch")
    .description("Launch the live terminal dashboard")
    .action(async () => {
      const instance = render(React.createElement(Dashboard));
      await instance.waitUntilExit();
    });
}

import type { Command } from "commander";
import chalk from "chalk";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function registerDashboard(program: Command): void {
  program
    .command("dashboard")
    .description("Launch the live project dashboard")
    .option("-p, --port <port>", "API server port", "3001")
    .option("--vite-port <port>", "Vite dev server port", "5173")
    .action(async (opts: { port: string; vitePort: string }) => {
      const stateDir = resolve(process.cwd(), ".openingday");
      const dashboardDir = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "dashboard",
      );

      console.log(chalk.bold("OpeningDay Dashboard"));
      console.log(chalk.gray(`State dir: ${stateDir}`));
      console.log(chalk.gray(`Dashboard: ${dashboardDir}`));
      console.log();

      const children: ChildProcess[] = [];

      const cleanup = () => {
        for (const child of children) {
          child.kill("SIGTERM");
        }
      };

      process.on("SIGINT", () => {
        console.log(chalk.yellow("\nShutting down dashboard..."));
        cleanup();
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        cleanup();
        process.exit(0);
      });

      // Spawn API server
      const apiServer = spawn("npx", ["tsx", resolve(dashboardDir, "src", "api", "server.ts")], {
        env: {
          ...process.env,
          OPENINGDAY_STATE_DIR: stateDir,
          PORT: opts.port,
        },
        stdio: "pipe",
        cwd: dashboardDir,
      });
      children.push(apiServer);

      apiServer.stdout?.on("data", (data: Buffer) => {
        process.stdout.write(chalk.cyan(`[api] ${data.toString()}`));
      });
      apiServer.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(chalk.red(`[api] ${data.toString()}`));
      });
      apiServer.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.error(chalk.red(`API server exited with code ${code}`));
        }
      });

      // Spawn Vite dev server
      const viteServer = spawn("npx", ["vite", "--port", opts.vitePort], {
        env: {
          ...process.env,
        },
        stdio: "pipe",
        cwd: dashboardDir,
      });
      children.push(viteServer);

      viteServer.stdout?.on("data", (data: Buffer) => {
        process.stdout.write(chalk.magenta(`[vite] ${data.toString()}`));
      });
      viteServer.stderr?.on("data", (data: Buffer) => {
        // Vite prints its normal output to stderr
        const text = data.toString();
        process.stderr.write(chalk.magenta(`[vite] ${text}`));
      });
      viteServer.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.error(chalk.red(`Vite server exited with code ${code}`));
        }
      });

      console.log(chalk.green(`API server:  http://localhost:${opts.port}`));
      console.log(chalk.green(`Dashboard:   http://localhost:${opts.vitePort}`));
      console.log();
      console.log(chalk.gray("Press Ctrl+C to stop"));

      // Keep the process alive
      await new Promise(() => {
        // Never resolves — process stays alive until SIGINT
      });
    });
}

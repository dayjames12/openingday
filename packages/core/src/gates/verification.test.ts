import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realDiffGate, realSecurityGate } from "./verification.js";
import type { WorkerOutput, WorkTree, CodeTree } from "../types.js";

const exec = promisify(execFile);

const emptyWorkTree: WorkTree = { milestones: [] };
const emptyCodeTree: CodeTree = { modules: [] };

function makeOutput(overrides: Partial<WorkerOutput> = {}): WorkerOutput {
  return {
    status: "complete",
    filesChanged: ["src/feature.ts"],
    interfacesModified: [],
    testsAdded: [],
    testResults: { pass: 5, fail: 0 },
    notes: "",
    tokensUsed: 3000,
    ...overrides,
  };
}

describe("verification gates", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "verification-gate-test-"));
    // Initialize a git repo so git diff works
    await exec("git", ["init"], { cwd: tmpDir });
    await exec("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    await exec("git", ["config", "user.name", "Test"], { cwd: tmpDir });
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "feature.ts"), "export const x = 1;\n", "utf-8");
    await exec("git", ["add", "."], { cwd: tmpDir });
    await exec("git", ["commit", "-m", "initial"], { cwd: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("realDiffGate", () => {
    it("passes when changed files match task touches", async () => {
      // Modify a declared file
      await writeFile(join(tmpDir, "src", "feature.ts"), "export const x = 2;\n", "utf-8");

      const gate = realDiffGate(["src/feature.ts"]);
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      expect(result.pass).toBe(true);
    });

    it("fails when undeclared file is changed", async () => {
      // Modify a file not in touches
      await writeFile(join(tmpDir, "src", "feature.ts"), "export const x = 2;\n", "utf-8");
      await writeFile(join(tmpDir, "src", "secret.ts"), "export const s = 'hi';\n", "utf-8");
      await exec("git", ["add", "src/secret.ts"], { cwd: tmpDir });

      const gate = realDiffGate(["src/feature.ts"]);
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      expect(result.pass).toBe(false);
      expect(result.issues.some((i) => i.rule === "undeclared-real-file-change")).toBe(true);
    });

    it("warns when worker reports phantom changes", async () => {
      // Don't actually change the file
      const gate = realDiffGate(["src/feature.ts"]);
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      // No real changes, but worker claimed src/feature.ts changed
      expect(result.issues.some((i) => i.rule === "phantom-file-change")).toBe(true);
    });
  });

  describe("realSecurityGate", () => {
    it("passes when files have no dangerous patterns", async () => {
      await writeFile(
        join(tmpDir, "src", "feature.ts"),
        "export function hello(): string { return 'hi'; }\n",
        "utf-8",
      );

      const gate = realSecurityGate();
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      expect(result.pass).toBe(true);
    });

    it("fails when eval is found in changed files", async () => {
      await writeFile(
        join(tmpDir, "src", "feature.ts"),
        "export function run(code: string) { return eval(code); }\n",
        "utf-8",
      );

      const gate = realSecurityGate();
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      expect(result.pass).toBe(false);
      expect(result.issues.some((i) => i.rule === "no-eval")).toBe(true);
    });

    it("fails when hardcoded secrets are found", async () => {
      await writeFile(
        join(tmpDir, "src", "feature.ts"),
        'const password = "super_secret_password_123";\n',
        "utf-8",
      );

      const gate = realSecurityGate();
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      expect(result.pass).toBe(false);
      expect(result.issues.some((i) => i.rule === "no-hardcoded-secrets")).toBe(true);
    });

    it("reports correct line numbers", async () => {
      await writeFile(
        join(tmpDir, "src", "feature.ts"),
        'const a = 1;\nconst b = 2;\nconst c = eval("3");\n',
        "utf-8",
      );

      const gate = realSecurityGate();
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/feature.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      const evalIssue = result.issues.find((i) => i.rule === "no-eval");
      expect(evalIssue).toBeDefined();
      expect(evalIssue!.line).toBe(3);
    });

    it("skips files that do not exist", async () => {
      const gate = realSecurityGate();
      const result = await gate.run(
        makeOutput({ filesChanged: ["src/nonexistent.ts"] }),
        emptyWorkTree,
        emptyCodeTree,
        tmpDir,
      );
      expect(result.pass).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});

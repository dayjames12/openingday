import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectWorktreeOutput, parseInterfaceChanges, parseTestOutput } from "./inspect.js";

const exec = promisify(execFile);

describe("inspectWorktreeOutput", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "od-inspect-test-"));
    await exec("git", ["init", repoDir]);
    await exec("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
    await exec("git", ["config", "user.name", "Test"], { cwd: repoDir });
    // Create initial commit with a file
    await writeFile(join(repoDir, "src.ts"), 'export function hello(): void {}\n');
    await exec("git", ["add", "."], { cwd: repoDir });
    await exec("git", ["commit", "-m", "init"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("detects modified files via git diff", async () => {
    await writeFile(join(repoDir, "src.ts"), 'export function hello(): string { return "hi"; }\n');

    const output = await inspectWorktreeOutput(repoDir, ["src.ts"], null);

    expect(output.status).toBe("complete");
    expect(output.filesChanged).toContain("src.ts");
    expect(output.tokensUsed).toBeGreaterThan(0);
    expect(output.notes).toContain("1 file(s) changed");
  });

  it("detects new untracked files", async () => {
    await writeFile(join(repoDir, "new-file.ts"), 'export const x = 1;\n');

    const output = await inspectWorktreeOutput(repoDir, ["new-file.ts"], null);

    expect(output.status).toBe("complete");
    expect(output.filesChanged).toContain("new-file.ts");
  });

  it("detects new test files", async () => {
    await writeFile(join(repoDir, "feature.test.ts"), 'import { test } from "vitest";\n');
    await writeFile(join(repoDir, "feature.spec.ts"), 'describe("x", () => {});\n');

    const output = await inspectWorktreeOutput(repoDir, [], null);

    expect(output.testsAdded).toContain("feature.test.ts");
    expect(output.testsAdded).toContain("feature.spec.ts");
  });

  it("returns failed status when no files changed", async () => {
    const output = await inspectWorktreeOutput(repoDir, ["src.ts"], null);

    expect(output.status).toBe("failed");
    expect(output.filesChanged).toEqual([]);
    expect(output.notes).toContain("0 file(s) changed");
  });

  it("detects interface changes in the diff", async () => {
    await writeFile(
      join(repoDir, "src.ts"),
      'export function hello(name: string): string { return name; }\n',
    );

    const output = await inspectWorktreeOutput(repoDir, ["src.ts"], null);

    expect(output.interfacesModified.length).toBeGreaterThanOrEqual(1);
    const change = output.interfacesModified.find((c) => c.export === "hello");
    expect(change).toBeDefined();
    expect(change!.before).toContain("export function hello");
    expect(change!.after).toContain("export function hello");
  });

  it("handles multiple modified files", async () => {
    await writeFile(join(repoDir, "a.ts"), 'export const a = 1;\n');
    await writeFile(join(repoDir, "b.ts"), 'export const b = 2;\n');

    const output = await inspectWorktreeOutput(repoDir, ["a.ts", "b.ts"], null);

    expect(output.status).toBe("complete");
    expect(output.filesChanged).toContain("a.ts");
    expect(output.filesChanged).toContain("b.ts");
    expect(output.notes).toContain("2 file(s) changed");
  });
});

describe("parseInterfaceChanges", () => {
  it("detects modified export signatures", () => {
    const diff = [
      "+++ b/src/api.ts",
      "-export function serve(port: number): void",
      "+export function serve(port: number, host?: string): void",
    ].join("\n");

    const changes = parseInterfaceChanges(diff);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.file).toBe("src/api.ts");
    expect(changes[0]!.export).toBe("serve");
    expect(changes[0]!.before).toContain("port: number");
    expect(changes[0]!.after).toContain("host?: string");
  });

  it("detects new exports", () => {
    const diff = [
      "+++ b/src/utils.ts",
      "+export function newHelper(): void",
    ].join("\n");

    const changes = parseInterfaceChanges(diff);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.export).toBe("newHelper");
    expect(changes[0]!.before).toBe("");
    expect(changes[0]!.after).toContain("export function newHelper");
  });

  it("handles const and class exports", () => {
    const diff = [
      "+++ b/src/config.ts",
      "-export const MAX_SIZE = 100",
      "+export const MAX_SIZE = 200",
      "+++ b/src/service.ts",
      "+export class UserService",
    ].join("\n");

    const changes = parseInterfaceChanges(diff);
    const maxSize = changes.find((c) => c.export === "MAX_SIZE");
    const userService = changes.find((c) => c.export === "UserService");

    expect(maxSize).toBeDefined();
    expect(maxSize!.before).toContain("MAX_SIZE");
    expect(userService).toBeDefined();
    expect(userService!.before).toBe("");
  });

  it("returns empty for diffs with no export changes", () => {
    const diff = [
      "+++ b/src/internal.ts",
      "-const x = 1;",
      "+const x = 2;",
    ].join("\n");

    expect(parseInterfaceChanges(diff)).toEqual([]);
  });
});

describe("parseTestOutput", () => {
  it("parses vitest-style output", () => {
    const output = `
 Test Files  3 passed (3)
      Tests  15 passed (15)
   Start at  10:08:44
   Duration  500ms
`;
    const result = parseTestOutput(output);
    expect(result.pass).toBe(15);
    expect(result.fail).toBe(0);
  });

  it("parses mixed pass/fail output", () => {
    const output = `
 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 10 passed (12)
`;
    const result = parseTestOutput(output);
    expect(result.pass).toBe(10);
    expect(result.fail).toBe(2);
  });

  it("returns zeros for unparseable output", () => {
    const result = parseTestOutput("some random output");
    expect(result.pass).toBe(0);
    expect(result.fail).toBe(0);
  });
});

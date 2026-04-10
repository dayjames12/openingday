import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileContents } from "./file-reader.js";

describe("readFileContents", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-reader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads files from disk", async () => {
    await writeFile(join(tempDir, "foo.ts"), "const x = 1;\n");

    const result = await readFileContents(tempDir, [], ["foo.ts"]);

    expect(result["foo.ts"]).toBe("const x = 1;\n");
  });

  it("deduplicates touches and reads", async () => {
    await writeFile(join(tempDir, "dup.ts"), "hello\n");

    const result = await readFileContents(tempDir, ["dup.ts", "dup.ts"], ["dup.ts"]);

    expect(Object.keys(result)).toEqual(["dup.ts"]);
    expect(result["dup.ts"]).toBe("hello\n");
  });

  it("skips files that don't exist", async () => {
    await writeFile(join(tempDir, "exists.ts"), "yes\n");

    const result = await readFileContents(
      tempDir,
      ["missing.ts"],
      ["exists.ts", "also-missing.ts"],
    );

    expect(Object.keys(result)).toEqual(["exists.ts"]);
    expect(result["exists.ts"]).toBe("yes\n");
  });

  it("truncates files over threshold", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(`line ${i}`);
    }
    // Insert some export lines beyond the first 50
    lines[100] = "export function foo() {}";
    lines[200] = "export const bar = 1;";
    const content = lines.join("\n");

    await writeFile(join(tempDir, "big.ts"), content);

    const result = await readFileContents(tempDir, [], ["big.ts"], 300);

    const output = result["big.ts"];

    // First 50 lines present
    expect(output).toContain("line 0");
    expect(output).toContain("line 49");

    // Truncation notice
    expect(output).toContain("truncated");
    expect(output).toContain("400 lines total");

    // Export lines present
    expect(output).toContain("export function foo() {}");
    expect(output).toContain("export const bar = 1;");

    // Lines beyond 50 that aren't exports should NOT be present
    expect(output).not.toContain("line 150");
  });

  it("does not truncate files under threshold", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`line ${i}`);
    }
    const content = lines.join("\n");

    await writeFile(join(tempDir, "small.ts"), content);

    const result = await readFileContents(tempDir, [], ["small.ts"], 300);

    expect(result["small.ts"]).toBe(content);
  });
});

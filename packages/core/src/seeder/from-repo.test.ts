import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRepo, extractExports, extractImports } from "./from-repo.js";

describe("from-repo", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "od-repo-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("extractExports", () => {
    it("extracts function exports", () => {
      const source = `export function hello(name: string): string { return name; }`;
      const exports = extractExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0]!.name).toBe("hello");
      expect(exports[0]!.signature).toContain("hello");
    });

    it("extracts async function exports", () => {
      const source = `export async function fetchData(url: string): Promise<Response> { return fetch(url); }`;
      const exports = extractExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0]!.name).toBe("fetchData");
    });

    it("extracts const exports", () => {
      const source = `export const PORT: number = 3000;`;
      const exports = extractExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0]!.name).toBe("PORT");
      expect(exports[0]!.signature).toContain("number");
    });

    it("extracts interface exports", () => {
      const source = `export interface Config { port: number; }`;
      const exports = extractExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0]!.name).toBe("Config");
      expect(exports[0]!.signature).toContain("interface");
    });

    it("extracts type exports", () => {
      const source = `export type Status = "ok" | "fail";`;
      const exports = extractExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0]!.name).toBe("Status");
      expect(exports[0]!.signature).toContain("type");
    });

    it("extracts class exports", () => {
      const source = `export class Logger { log(msg: string) {} }`;
      const exports = extractExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0]!.name).toBe("Logger");
      expect(exports[0]!.signature).toContain("class");
    });
  });

  describe("extractImports", () => {
    it("extracts named imports", () => {
      const source = `import { readFile, writeFile } from "node:fs/promises";`;
      const imports = extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.from).toBe("node:fs/promises");
      expect(imports[0]!.names).toEqual(["readFile", "writeFile"]);
    });

    it("extracts type imports", () => {
      const source = `import type { Config } from "./config.js";`;
      const imports = extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.from).toBe("./config.js");
      expect(imports[0]!.names).toEqual(["Config"]);
    });
  });

  describe("scanRepo", () => {
    it("scans repo with TS files and finds exports", async () => {
      // Create a minimal repo structure
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(
        join(tempDir, "src", "index.ts"),
        `export function main(): void { console.log("hello"); }\nexport const VERSION: string = "1.0.0";\n`,
      );
      await writeFile(
        join(tempDir, "src", "utils.ts"),
        `import { main } from "./index.js";\nexport function helper(x: number): number { return x + 1; }\n`,
      );

      const tree = await scanRepo(tempDir);
      expect(tree.modules.length).toBeGreaterThanOrEqual(1);

      const srcModule = tree.modules.find((m) => m.path === "src");
      expect(srcModule).toBeDefined();
      expect(srcModule!.files).toHaveLength(2);

      const indexFile = srcModule!.files.find((f) => f.path === "src/index.ts");
      expect(indexFile).toBeDefined();
      expect(indexFile!.exports.length).toBeGreaterThanOrEqual(1);
      expect(indexFile!.exports.some((e) => e.name === "main")).toBe(true);

      const utilsFile = srcModule!.files.find((f) => f.path === "src/utils.ts");
      expect(utilsFile).toBeDefined();
      expect(utilsFile!.imports).toHaveLength(1);
      expect(utilsFile!.imports[0]!.from).toBe("./index.js");
    });

    it("handles empty directory", async () => {
      const tree = await scanRepo(tempDir);
      expect(tree.modules).toHaveLength(0);
    });

    it("ignores node_modules and dist", async () => {
      await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
      await writeFile(
        join(tempDir, "node_modules", "pkg", "index.ts"),
        `export function hidden(): void {}`,
      );
      await mkdir(join(tempDir, "dist"), { recursive: true });
      await writeFile(join(tempDir, "dist", "bundle.ts"), `export function bundled(): void {}`);
      // One real file
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "app.ts"), `export function app(): void {}`);

      const tree = await scanRepo(tempDir);
      const allPaths = tree.modules.flatMap((m) => m.files.map((f) => f.path));

      expect(allPaths).not.toContain(expect.stringContaining("node_modules"));
      expect(allPaths).not.toContain(expect.stringContaining("dist"));
      expect(allPaths).toContain("src/app.ts");
    });
  });
});

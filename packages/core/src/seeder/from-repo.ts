import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CodeTree, CodeModule, CodeFile, CodeExport, CodeImport } from "../types.js";

// === Constants ===

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "build",
  "out",
  ".cache",
]);

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

// === Export Extraction (regex-based, MVP) ===

/**
 * Extract exported symbols from TypeScript source text using regex.
 */
export function extractExports(source: string): CodeExport[] {
  const exports: CodeExport[] = [];

  // export function name(params): ReturnType
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))(?:\s*:\s*([^\n{]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(source)) !== null) {
    const name = match[1]!;
    const params = match[2]!;
    const returnType = match[3]?.trim() ?? "void";
    exports.push({
      name,
      signature: `${name}${params}: ${returnType}`,
      description: "",
    });
  }

  // export const/let name: Type
  const constRegex = /export\s+(?:const|let)\s+(\w+)\s*(?::\s*([^\n=]+?))?(?:\s*=)/g;
  while ((match = constRegex.exec(source)) !== null) {
    const name = match[1]!;
    const type = match[2]?.trim() ?? "unknown";
    exports.push({
      name,
      signature: `const ${name}: ${type}`,
      description: "",
    });
  }

  // export interface/type Name
  const typeRegex = /export\s+(interface|type)\s+(\w+)/g;
  while ((match = typeRegex.exec(source)) !== null) {
    const kind = match[1]!;
    const name = match[2]!;
    exports.push({
      name,
      signature: `${kind} ${name}`,
      description: "",
    });
  }

  // export class Name
  const classRegex = /export\s+class\s+(\w+)/g;
  while ((match = classRegex.exec(source)) !== null) {
    const name = match[1]!;
    exports.push({
      name,
      signature: `class ${name}`,
      description: "",
    });
  }

  return exports;
}

// === Import Extraction ===

/**
 * Extract import statements from TypeScript source text using regex.
 */
export function extractImports(source: string): CodeImport[] {
  const imports: CodeImport[] = [];

  // import { names } from "path"
  const importRegex = /import\s+(?:type\s+)?{([^}]+)}\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const names = match[1]!
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    const from = match[2]!;
    imports.push({ from, names });
  }

  return imports;
}

// === Directory Walking ===

/**
 * Recursively walk a directory and collect all TypeScript file paths.
 */
async function walkDir(dir: string, rootDir: string): Promise<string[]> {
  const files: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const subFiles = await walkDir(join(dir, entry.name), rootDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (TS_EXTENSIONS.has(ext)) {
        files.push(join(dir, entry.name));
      }
    }
  }

  return files;
}

// === Main Scanner ===

/**
 * Scan a TypeScript repository directory and build a CodeTree.
 * Walks the directory tree, finds .ts/.tsx files (ignoring node_modules, dist, .git, etc.),
 * extracts exports and imports with regex, and groups files by top-level directory into modules.
 */
export async function scanRepo(repoDir: string): Promise<CodeTree> {
  const absolutePaths = await walkDir(repoDir, repoDir);
  const filesByModule = new Map<string, CodeFile[]>();

  for (const absPath of absolutePaths) {
    const relPath = relative(repoDir, absPath);
    const source = await readFile(absPath, "utf-8");

    const exports = extractExports(source);
    const imports = extractImports(source);

    const codeFile: CodeFile = {
      path: relPath,
      description: "",
      exports,
      imports,
      lastModifiedBy: null,
    };

    // Group by top-level directory (or root for files at top level)
    const parts = relPath.split("/");
    const modulePath = parts.length > 1 ? parts[0]! : ".";

    const existing = filesByModule.get(modulePath) ?? [];
    existing.push(codeFile);
    filesByModule.set(modulePath, existing);
  }

  const modules: CodeModule[] = [];
  for (const [modulePath, files] of filesByModule) {
    modules.push({
      path: modulePath,
      description: "",
      files,
    });
  }

  return { modules };
}

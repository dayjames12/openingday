import type { CodeTree, CodeModule, CodeFile, CodeExport, CodeImport } from "../types.js";

// === Factory ===

export function createCodeTree(): CodeTree {
  return { modules: [] };
}

// === Module CRUD ===

export function addModule(
  tree: CodeTree,
  mod: Pick<CodeModule, "path" | "description">,
): CodeTree {
  const newModule: CodeModule = {
    path: mod.path,
    description: mod.description,
    files: [],
  };
  return { modules: [...tree.modules, newModule] };
}

export function getModule(tree: CodeTree, modulePath: string): CodeModule | null {
  return tree.modules.find((m) => m.path === modulePath) ?? null;
}

// === File CRUD ===

export function addFile(
  tree: CodeTree,
  modulePath: string,
  file: Pick<CodeFile, "path" | "description" | "exports" | "imports">,
): CodeTree {
  const newFile: CodeFile = {
    path: file.path,
    description: file.description,
    exports: file.exports,
    imports: file.imports,
    lastModifiedBy: null,
  };
  return {
    modules: tree.modules.map((m) => {
      if (m.path !== modulePath) return m;
      return { ...m, files: [...m.files, newFile] };
    }),
  };
}

export function getFile(tree: CodeTree, filePath: string): CodeFile | null {
  for (const m of tree.modules) {
    for (const f of m.files) {
      if (f.path === filePath) return f;
    }
  }
  return null;
}

export function getAllFiles(tree: CodeTree): CodeFile[] {
  return tree.modules.flatMap((m) => m.files);
}

// === File Updates ===

export function updateFile(
  tree: CodeTree,
  filePath: string,
  updates: Partial<CodeFile>,
): CodeTree {
  return {
    modules: tree.modules.map((m) => ({
      ...m,
      files: m.files.map((f) =>
        f.path === filePath ? { ...f, ...updates } : f,
      ),
    })),
  };
}

export function setLastModifiedBy(
  tree: CodeTree,
  filePath: string,
  taskId: string,
): CodeTree {
  return updateFile(tree, filePath, { lastModifiedBy: taskId });
}

// === Export / Import Queries ===

export function getFileExports(tree: CodeTree, filePath: string): CodeExport[] {
  const file = getFile(tree, filePath);
  return file ? file.exports : [];
}

export function getFileImports(tree: CodeTree, filePath: string): CodeImport[] {
  const file = getFile(tree, filePath);
  return file ? file.imports : [];
}

/**
 * Find all files that import from the given file path.
 */
export function getDependents(tree: CodeTree, filePath: string): CodeFile[] {
  return getAllFiles(tree).filter((f) =>
    f.imports.some((imp) => imp.from === filePath),
  );
}

/**
 * Find all files that the given file imports from.
 */
export function getDependencies(tree: CodeTree, filePath: string): CodeFile[] {
  const file = getFile(tree, filePath);
  if (!file) return [];
  const importPaths = new Set(file.imports.map((imp) => imp.from));
  return getAllFiles(tree).filter((f) => importPaths.has(f.path));
}

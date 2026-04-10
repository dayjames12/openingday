import { readFile } from "node:fs/promises";

/**
 * Read file contents for a set of touched/read paths, deduplicating and
 * truncating large files to first 50 lines + export lines.
 */
export async function readFileContents(
  basePath: string,
  touches: string[],
  reads: string[],
  truncateThreshold = 300,
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  const allPaths = [...new Set([...touches, ...reads])];

  for (const filePath of allPaths) {
    try {
      const fullPath = `${basePath}/${filePath}`;
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      if (lines.length > truncateThreshold) {
        const first50 = lines.slice(0, 50).join("\n");
        const exportLines = lines
          .filter((l) => l.startsWith("export "))
          .join("\n");
        contents[filePath] =
          `${first50}\n\n// ... (${lines.length} lines total, truncated) ...\n\n// Exports:\n${exportLines}`;
      } else {
        contents[filePath] = content;
      }
    } catch {
      // File doesn't exist yet (new file) — skip
    }
  }

  return contents;
}

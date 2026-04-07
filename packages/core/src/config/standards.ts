import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface StandardsFile {
  name: string;
  description?: string;
  extends?: string[];
  rules: Record<string, string[]>;
}

export interface MergedStandards {
  rules: Record<string, string[]>;
}

export async function loadStandards(
  names: string[],
  standardsDir: string,
): Promise<MergedStandards> {
  const merged: Record<string, string[]> = {};
  const loaded = new Set<string>();

  async function loadOne(name: string): Promise<void> {
    if (loaded.has(name)) return;
    loaded.add(name);

    const filePath = join(standardsDir, `${name}.json`);
    const content = await readFile(filePath, "utf-8");
    const file = JSON.parse(content) as StandardsFile;

    if (file.extends) {
      for (const dep of file.extends) {
        await loadOne(dep);
      }
    }

    for (const [category, rules] of Object.entries(file.rules)) {
      if (!merged[category]) {
        merged[category] = [];
      }
      for (const rule of rules) {
        if (!merged[category].includes(rule)) {
          merged[category].push(rule);
        }
      }
    }
  }

  for (const name of names) {
    await loadOne(name);
  }

  return { rules: merged };
}

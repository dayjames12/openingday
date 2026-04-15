import type { GateResult, GateIssue } from "../types.js";

export function extractContractExports(source: string): string[] {
  const exportRegex = /export\s+(?:interface|type|enum|const|function)\s+(\w+)/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(source)) !== null) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

export function validateContracts(
  contractsSource: string,
  _touchedFiles: string[],
  fileContents?: Record<string, string>,
): GateResult {
  const issues: GateIssue[] = [];
  if (!contractsSource || contractsSource.trim().length === 0) {
    return { layer: "automated", pass: true, issues: [], timestamp: new Date().toISOString() };
  }
  const exports = extractContractExports(contractsSource);
  if (fileContents) {
    const allContent = Object.values(fileContents).join("\n");
    for (const name of exports) {
      if (!allContent.includes(name)) {
        issues.push({
          severity: "low",
          rule: "unused-contract-export",
          file: "contracts.ts",
          note: `Export "${name}" is not referenced in any touched file`,
        });
      }
    }
  }
  return { layer: "automated", pass: true, issues, timestamp: new Date().toISOString() };
}

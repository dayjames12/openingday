import { agentRole, digestConstraints } from "./partials/index.js";
import type { RepoMap } from "../scanner/types.js";

export interface ContractPromptArgs {
  specText: string;
  repoMap?: RepoMap | null;
  budget: number;
}

export function contractPrompt(args: ContractPromptArgs): string {
  const parts = [
    agentRole("type-architect"),
    "task:extract-domain-types-from-spec",
    "rules:[exact-domain-language,every-entity-becomes-interface,export-all,types-only,no-imports,self-contained]",
    `spec:\n${args.specText}`,
    "out:valid-typescript-source|no-markdown-fences|no-explanation",
    digestConstraints(args.budget),
  ];

  if (args.repoMap) {
    const existingTypes: string[] = [];
    for (const mod of args.repoMap.modules) {
      for (const file of mod.files) {
        for (const ex of file.ex) {
          if (ex.s.includes("interface") || ex.s.includes("type") || ex.s.includes("enum")) {
            existingTypes.push(`// ${file.p}\n${ex.s}`);
          }
        }
      }
    }
    if (existingTypes.length > 0) {
      parts.push(`existing-types:\n${existingTypes.join("\n\n")}`);
      parts.push("hint:merge-with-existing|preserve-field-names");
    }
  }

  return parts.join("|");
}

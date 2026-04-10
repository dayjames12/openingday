import { agentRole, reviewFormat, digestConstraints } from "./partials/index.js";

export interface ReviewPromptArgs {
  diff: string;
  contracts: string;
  specExcerpt: string;
  budget: number;
}

export function reviewPrompt(args: ReviewPromptArgs): string {
  return [
    agentRole("code-reviewer"),
    `contracts:\n${args.contracts || "(none)"}`,
    `spec:\n${args.specExcerpt || "(none)"}`,
    `diff:\n${args.diff}`,
    "check:[domain-fidelity,pattern-consistency,no-duplication,proper-imports,middleware-order,test-coverage]",
    reviewFormat(),
    digestConstraints(args.budget),
  ].join("|");
}

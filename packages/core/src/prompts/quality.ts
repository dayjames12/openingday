import { agentRole, qualityFormat, digestConstraints } from "./partials/index.js";

export interface QualityPromptArgs {
  diff: string;
  standards: string;
  budget: number;
}

export function qualityPrompt(args: QualityPromptArgs): string {
  return [
    agentRole("quality-reviewer"),
    `standards:\n${args.standards}`,
    `diff:\n${args.diff}`,
    qualityFormat(),
    digestConstraints(args.budget),
  ].join("|");
}

import { agentRole, errorListFormat, digestConstraints } from "./partials/index.js";

export interface FeedbackPromptArgs {
  stage: "compile" | "test";
  rawOutput: string;
  budget: number;
}

export function feedbackPrompt(args: FeedbackPromptArgs): string {
  const outputSlice = args.rawOutput.slice(0, 3000);

  return [
    agentRole(`${args.stage}-feedback`),
    `task:digest-${args.stage}-errors`,
    `raw:\n${outputSlice}`,
    errorListFormat(),
    digestConstraints(args.budget),
    args.stage === "compile"
      ? "hint:reference-actual-types-and-imports|be-specific-about-fixes"
      : "hint:identify-root-cause|reference-test-names",
  ].join("|");
}

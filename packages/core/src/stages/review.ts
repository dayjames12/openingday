// packages/core/src/stages/review.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StageResult, StageFeedback } from "../types.js";
import { reviewPrompt } from "../prompts/review.js";

/**
 * Build a prompt for the AI reviewer.
 */
export function buildReviewPrompt(diff: string, contracts: string, specExcerpt: string): string {
  return reviewPrompt({ diff, contracts, specExcerpt, budget: 0.5 });
}

/**
 * Parse the AI reviewer's response into a StageResult.
 */
export function parseReviewResponse(text: string): { passed: boolean; feedback: StageFeedback[] } {
  try {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      approved: boolean;
      issues: { f: string; l: number; e: string; fix: string }[];
    };

    if (parsed.approved && (!parsed.issues || parsed.issues.length === 0)) {
      return { passed: true, feedback: [] };
    }

    const feedback: StageFeedback = {
      stage: "review",
      errors: (parsed.issues ?? []).map((i) => ({
        f: i.f,
        l: i.l ?? 0,
        e: i.e,
        fix: i.fix ?? "",
      })),
    };

    return {
      passed: parsed.approved === true && feedback.errors.length === 0,
      feedback: feedback.errors.length > 0 ? [feedback] : [],
    };
  } catch {
    return {
      passed: false,
      feedback: [
        {
          stage: "review",
          errors: [
            {
              f: "unknown",
              l: 0,
              e: "Review response was not parseable JSON",
              fix: "Re-run review",
            },
          ],
        },
      ],
    };
  }
}

/**
 * Run the review stage by sending the diff to an AI reviewer.
 * Does NOT loop internally — the caller (orchestrator) handles the loop.
 */
export async function runReviewStage(
  worktreePath: string,
  diff: string,
  contracts: string,
  specExcerpt: string,
  taskBudget: number,
): Promise<StageResult> {
  const prompt = buildReviewPrompt(diff, contracts, specExcerpt);

  const stream = query({
    prompt,
    options: {
      model: "claude-opus-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: taskBudget / 4,
      persistSession: false,
      cwd: worktreePath,
      allowedTools: [],
    },
  });

  let resultMsg: SDKResultMessage | null = null;
  for await (const msg of stream) {
    if (msg.type === "result") {
      resultMsg = msg;
    }
  }

  if (!resultMsg || resultMsg.subtype !== "success") {
    return {
      stage: "review",
      passed: false,
      loops: 0,
      feedback: [
        {
          stage: "review",
          errors: [
            { f: "unknown", l: 0, e: "AI reviewer failed to produce result", fix: "Retry review" },
          ],
        },
      ],
    };
  }

  const parsed = parseReviewResponse(resultMsg.result);

  return {
    stage: "review",
    passed: parsed.passed,
    loops: 0,
    feedback: parsed.feedback,
  };
}

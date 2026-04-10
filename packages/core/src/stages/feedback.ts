// packages/core/src/stages/feedback.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StageFeedback, StageType } from "../types.js";
import { feedbackPrompt } from "../prompts/feedback.js";

/**
 * Parse an AI feedback response into a StageFeedback object.
 */
export function parseFeedbackResponse(text: string, stage: StageType): StageFeedback {
  try {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as { errors: { f: string; l: number; e: string; fix: string }[] };
    return {
      stage,
      errors: (parsed.errors ?? []).map((e) => ({
        f: e.f ?? "unknown",
        l: e.l ?? 0,
        e: e.e ?? "",
        fix: e.fix ?? "",
      })),
    };
  } catch {
    return {
      stage,
      errors: [{ f: "unknown", l: 0, e: text.slice(0, 500), fix: "Review raw output and fix" }],
    };
  }
}

/**
 * Use AI to digest raw tsc output into structured feedback.
 * Wire-mode output: compact JSON with file, line, error, fix.
 */
export async function digestCompileErrors(
  rawOutput: string,
  cwd: string,
  budget: number,
): Promise<StageFeedback> {
  try {
    const prompt = feedbackPrompt({ stage: "compile", rawOutput, budget });

    const stream = query({
      prompt,
      options: {
        model: "claude-opus-4-20250514",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: budget,
        persistSession: false,
        cwd,
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
        stage: "compile",
        errors: [{ f: "unknown", l: 0, e: rawOutput.slice(0, 500), fix: "Fix TypeScript compilation errors" }],
      };
    }

    return parseFeedbackResponse(resultMsg.result, "compile");
  } catch {
    return {
      stage: "compile",
      errors: [{ f: "", l: 0, e: `Digest failed: ${rawOutput.slice(0, 500)}`, fix: "" }],
    };
  }
}

/**
 * Use AI to digest raw test failure output into structured feedback.
 * Wire-mode output: compact JSON with file, line, error, fix.
 */
export async function digestTestFailures(
  rawOutput: string,
  cwd: string,
  budget: number,
): Promise<StageFeedback> {
  try {
    const prompt = feedbackPrompt({ stage: "test", rawOutput, budget });

    const stream = query({
      prompt,
      options: {
        model: "claude-opus-4-20250514",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: budget,
        persistSession: false,
        cwd,
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
        stage: "test",
        errors: [{ f: "unknown", l: 0, e: rawOutput.slice(0, 500), fix: "Fix failing tests" }],
      };
    }

    return parseFeedbackResponse(resultMsg.result, "test");
  } catch {
    return {
      stage: "test",
      errors: [{ f: "", l: 0, e: `Digest failed: ${rawOutput.slice(0, 500)}`, fix: "" }],
    };
  }
}

/**
 * Convert raw review text into a StageFeedback.
 * No AI call — just parses the structured response from the reviewer.
 */
export function digestReviewIssues(rawReview: string): StageFeedback {
  try {
    let jsonStr = rawReview.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as { issues: { f: string; l: number; e: string; fix: string }[] };
    return {
      stage: "review",
      errors: (parsed.issues ?? []).map((i) => ({
        f: i.f ?? "unknown",
        l: i.l ?? 0,
        e: i.e ?? "",
        fix: i.fix ?? "",
      })),
    };
  } catch {
    return {
      stage: "review",
      errors: [{ f: "unknown", l: 0, e: `Failed to parse review response: ${rawReview.slice(0, 200)}`, fix: "Re-run review" }],
    };
  }
}

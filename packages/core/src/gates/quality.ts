import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GateResult, GateIssue } from "../types.js";
import type { GateCheck } from "./pipeline.js";
import { qualityPrompt } from "../prompts/quality.js";

// === Types ===

export interface QualityReviewResult {
  pass: boolean;
  issues: Array<{
    rule: string;
    file: string;
    note: string;
    severity?: "high" | "low";
  }>;
}

// === Pure Functions ===

/**
 * Build a review prompt from a diff and coding standards.
 */
export function buildQualityPrompt(diff: string, standards: string): string {
  return qualityPrompt({ diff, standards, budget: 0.5 });
}

/**
 * Parse a quality review response. Returns null if the response is not valid JSON.
 */
export function parseQualityResponse(text: string): QualityReviewResult | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.pass !== "boolean") return null;
    if (!Array.isArray(parsed.issues)) return null;
    return parsed as unknown as QualityReviewResult;
  } catch {
    return null;
  }
}

// === SDK Call ===

/**
 * Run an AI-powered quality review using the Agent SDK.
 * Calls query() with tools disabled (no file access, no shell).
 */
export async function runQualityReview(
  diff: string,
  standards: string,
  cwd: string,
  budgetUsd?: number,
): Promise<GateResult> {
  const prompt = buildQualityPrompt(diff, standards);

  const stream = query({
    prompt,
    options: {
      systemPrompt: "You are a code quality reviewer. Output only valid JSON.",
      model: "claude-sonnet-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: budgetUsd ?? 0.5,
      persistSession: false,
      cwd,
      allowedTools: [], // No tools — pure text review
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
      layer: "quality",
      pass: false,
      issues: [
        {
          severity: "high",
          rule: "quality-review-error",
          file: "",
          note: resultMsg
            ? `Quality review failed: ${(resultMsg as { errors?: string[] }).errors?.join("; ") ?? "unknown"}`
            : "Quality review: no result from Agent SDK",
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  const parsed = parseQualityResponse(resultMsg.result);
  if (!parsed) {
    return {
      layer: "quality",
      pass: false,
      issues: [
        {
          severity: "high",
          rule: "quality-review-parse-error",
          file: "",
          note: "Failed to parse quality review response as JSON",
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  const issues: GateIssue[] = parsed.issues.map((i) => ({
    severity: i.severity ?? "low",
    rule: i.rule,
    file: i.file,
    note: i.note,
  }));

  return {
    layer: "quality",
    pass: parsed.pass,
    issues,
    timestamp: new Date().toISOString(),
  };
}

// === Synchronous Gate Check ===

/**
 * Create a synchronous quality gate check that validates worker output notes
 * against coding standards keywords. This is a lightweight fallback that
 * does not call the AI — it just checks for basic standards compliance markers.
 */
export function createQualityGateCheck(standards: string): GateCheck {
  return {
    layer: "quality",
    run(output) {
      const issues: GateIssue[] = [];

      // Basic heuristic: flag if output notes mention known anti-patterns
      const antiPatterns = ["TODO", "HACK", "FIXME", "XXX"];
      for (const pattern of antiPatterns) {
        if (output.notes.includes(pattern)) {
          issues.push({
            severity: "low",
            rule: "quality-anti-pattern",
            file: "",
            note: `Worker notes contain "${pattern}" marker`,
          });
        }
      }

      // Check that standards reference is non-empty when standards provided
      if (
        standards.length > 0 &&
        output.filesChanged.length === 0 &&
        output.status === "complete"
      ) {
        issues.push({
          severity: "low",
          rule: "quality-no-changes",
          file: "",
          note: "Worker reported complete but changed no files",
        });
      }

      return {
        layer: "quality",
        pass: issues.filter((i) => i.severity === "high").length === 0,
        issues,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

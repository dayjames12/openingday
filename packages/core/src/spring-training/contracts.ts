import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RepoMap } from "../scanner/types.js";
import { contractPrompt } from "../prompts/contracts.js";

/**
 * Build a prompt for contract generation from spec text.
 */
export function buildContractPrompt(specText: string, repoMap?: RepoMap | null): string {
  return contractPrompt({ specText, repoMap, budget: 0.5 });
}

/**
 * Parse the AI response to extract TypeScript contract source.
 * Strips markdown fences if present. Returns empty string on invalid input.
 */
export function parseContractResponse(text: string): string {
  let source = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = source.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    source = fenceMatch[1]!.trim();
  }

  // Validate it looks like TypeScript types
  if (
    !source.includes("export") ||
    (!source.includes("interface") && !source.includes("type") && !source.includes("enum"))
  ) {
    return "";
  }

  return source;
}

/**
 * Generate shared contracts file from spec using Agent SDK (Opus).
 */
export async function generateContracts(
  specText: string,
  repoMap?: RepoMap | null,
  cwd?: string,
  budgetUsd?: number,
  model?: string,
): Promise<string> {
  const prompt = buildContractPrompt(specText, repoMap);

  const stream = query({
    prompt,
    options: {
      model: model ?? "claude-opus-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: budgetUsd ?? 0.5,
      persistSession: false,
      cwd: cwd ?? process.cwd(),
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
    return "";
  }

  return parseContractResponse(resultMsg.result);
}

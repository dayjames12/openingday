import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RepoMap } from "../scanner/types.js";

/**
 * Build a prompt for contract generation from spec text.
 */
export function buildContractPrompt(specText: string, repoMap?: RepoMap | null): string {
  let prompt = `You are a TypeScript type architect.

Given the following project specification, extract ALL domain entities, interfaces, and types referenced in the spec. Generate a single TypeScript file containing only type definitions (interfaces, types, enums). This file will be the single source of truth for shared types — every worker will import from it.

## Rules

1. Use the spec's domain language EXACTLY — do not substitute generic alternatives
2. Every entity mentioned in the spec becomes an interface
3. Every enum/union mentioned becomes a type
4. Include JSDoc comments extracted from spec context
5. Export everything
6. No implementation code — types only
7. No imports — this file is self-contained

## Specification

${specText}

Output ONLY valid TypeScript source code. No markdown fences, no explanation.`;

  if (repoMap) {
    const existingTypes: string[] = [];
    for (const mod of repoMap.modules) {
      for (const file of mod.files) {
        for (const ex of file.ex) {
          if (ex.s.includes("interface") || ex.s.includes("type") || ex.s.includes("enum")) {
            existingTypes.push(`// ${file.p}\n${ex.s}`);
          }
        }
      }
    }
    if (existingTypes.length > 0) {
      prompt += `\n\nEXISTING TYPES (merge with spec additions, preserve existing field names):\n\n${existingTypes.join("\n\n")}`;
    }
  }

  return prompt;
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
  if (!source.includes("export") || (!source.includes("interface") && !source.includes("type") && !source.includes("enum"))) {
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
): Promise<string> {
  const prompt = buildContractPrompt(specText, repoMap);

  const stream = query({
    prompt,
    options: {
      model: "claude-opus-4-20250514",
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

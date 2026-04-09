import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContextPackage, WirePrompt, WireResponse, WorkerOutput } from "../types.js";
import { toWirePrompt, fromWireResponse } from "../wire/wire.js";
import { withRetry } from "../utils/retry.js";

// === Types ===

export interface SpawnOptions {
  taskId: string;
  worktreePath: string;
  context: ContextPackage;
  budgetUsd: number;
  model?: string;
}

export interface SpawnResult {
  output: WorkerOutput;
  costUsd: number;
  sessionId: string;
  needsInspection: boolean;
}

// === Pure Functions ===

/**
 * Build the system prompt that instructs the agent to operate in wire mode.
 * The agent receives a WirePrompt JSON object and must return a WireResponse JSON object.
 */
export function buildSystemPrompt(): string {
  return `You are a coding agent operating in wire mode.

You will receive a JSON object (WirePrompt) describing your task, the files you may modify, read-only context files, acceptance criteria, memory notes, and a token budget.

Complete the task by modifying files in your working directory. When finished, output ONLY a single JSON object matching the WireResponse schema. No other text before or after.

WireResponse schema:
{
  "s": "ok" | "partial" | "fail",
  "changed": string[],        // paths of files you changed
  "iface": [                   // interface changes (exports modified)
    { "f": string, "e": string, "b": string, "a": string }
  ],
  "tests": { "p": number, "f": number },  // pass/fail counts
  "t": number,                 // approximate tokens used
  "n": string                  // notes about what you did
}

Rules:
- Only modify files listed in the "files" field of the prompt
- Read-only files in "reads" are for context only
- Meet all acceptance criteria listed in "accept"
- Stay within the token budget
- Output valid JSON only -- no markdown fences, no explanation

COMMON PITFALLS — avoid these:
- Express 5: use "/{*path}" not "/*" for catch-all routes
- ESM: use import.meta.url + fileURLToPath instead of __dirname
- ESM: include .js extensions in relative imports
- Vite: add src/vite-env.d.ts with /// <reference types="vite/client" />
- TypeScript: handle potentially undefined array access with ! or null checks
- Middleware: register static file serving BEFORE 404 handlers
- Types: match the spec's domain language exactly — don't substitute generic fields`;
}

/**
 * Build the user prompt by serializing the wire prompt as JSON.
 */
export function buildUserPrompt(wire: WirePrompt): string {
  return JSON.stringify(wire);
}

/**
 * Parse an SDK result message into our SpawnResult type.
 * Handles both success and error subtypes.
 */
export function parseSpawnResult(resultMsg: SDKResultMessage): SpawnResult {
  const costUsd = resultMsg.total_cost_usd;
  const sessionId = resultMsg.session_id;

  if (resultMsg.subtype === "success") {
    // Check structured_output first (available when outputFormat is set)
    if ("structured_output" in resultMsg && resultMsg.structured_output) {
      const wire = resultMsg.structured_output as WireResponse;
      return { output: fromWireResponse(wire), costUsd, sessionId, needsInspection: false };
    }

    // Fallback: direct JSON.parse
    try {
      const wire = JSON.parse(resultMsg.result) as WireResponse;
      const output = fromWireResponse(wire);
      return { output, costUsd, sessionId, needsInspection: false };
    } catch {}

    // Regex fallback — extract JSON from markdown/prose
    const jsonMatch = resultMsg.result.match(/\{[\s\S]*"s"\s*:\s*"(?:ok|partial|fail)"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const wire = JSON.parse(jsonMatch[0]) as WireResponse;
        return { output: fromWireResponse(wire), costUsd, sessionId, needsInspection: false };
      } catch {}
    }

    // All parse attempts failed — flag for worktree inspection
    return {
      output: {
        status: "complete",
        filesChanged: [],
        interfacesModified: [],
        testsAdded: [],
        testResults: { pass: 0, fail: 0 },
        notes: "Wire parse failed, needs worktree inspection",
        tokensUsed: 0,
      },
      costUsd,
      sessionId,
      needsInspection: true,
    };
  }

  // Error subtypes: error_during_execution, error_max_turns, error_max_budget_usd, etc.
  const errors = resultMsg.errors;
  return {
    output: {
      status: "failed",
      filesChanged: [],
      interfacesModified: [],
      testsAdded: [],
      testResults: { pass: 0, fail: 0 },
      notes: `Agent error (${resultMsg.subtype}): ${errors.join("; ")}`.slice(0, 500),
      tokensUsed: 0,
    },
    costUsd,
    sessionId,
    needsInspection: false,
  };
}

// === SDK Call ===

/**
 * Spawn a real Agent SDK session to execute a task.
 * Converts context into wire-mode prompts, calls the SDK, and parses the result.
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  return withRetry(async () => {
    const { worktreePath, context, budgetUsd, model } = options;

    const wire = toWirePrompt(context);
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(wire);

    const stream = query({
      prompt: userPrompt,
      options: {
        systemPrompt,
        model: model ?? "claude-opus-4-20250514",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: budgetUsd,
        persistSession: false,
        cwd: worktreePath,
        settingSources: ["project"],
        outputFormat: {
          type: "json_schema" as const,
          schema: {
            type: "object",
            properties: {
              s: { type: "string", enum: ["ok", "partial", "fail"] },
              changed: { type: "array", items: { type: "string" } },
              iface: { type: "array", items: {
                type: "object",
                properties: {
                  f: { type: "string" },
                  e: { type: "string" },
                  b: { type: "string" },
                  a: { type: "string" },
                },
                required: ["f", "e", "b", "a"],
              }},
              tests: { type: "object", properties: { p: { type: "number" }, f: { type: "number" } }, required: ["p", "f"] },
              t: { type: "number" },
              n: { type: "string" },
            },
            required: ["s", "changed", "iface", "tests", "t", "n"],
          },
        },
      },
    });

    let resultMsg: SDKResultMessage | null = null;
    for await (const msg of stream) {
      if (msg.type === "result") {
        resultMsg = msg;
      }
    }

    if (!resultMsg) {
      return {
        output: {
          status: "failed",
          filesChanged: [],
          interfacesModified: [],
          testsAdded: [],
          testResults: { pass: 0, fail: 0 },
          notes: "Agent SDK stream ended without a result message",
          tokensUsed: 0,
        },
        costUsd: 0,
        sessionId: "",
        needsInspection: false,
      };
    }

    return parseSpawnResult(resultMsg);
  }, { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 5000 });
}

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { WorkTree, CodeTree } from "../types.js";
import type { RepoMap } from "../scanner/types.js";
import { buildLandscape } from "../scanner/scan.js";

// === Types ===

export interface SeederOutput {
  workTree: WorkTree;
  codeTree: CodeTree;
}

// === Prompt Builder ===

/**
 * Build a prompt that instructs the AI to generate a work tree and code tree
 * from a project specification.
 */
export function buildSeederPrompt(specText: string, projectName: string, repoMap?: RepoMap | null): string {
  let base = `You are a project planner for "${projectName}".

Given the following specification, generate a JSON object with two keys: "workTree" and "codeTree".

## Specification

${specText}

## WorkTree Structure

The workTree should have milestones, each containing slices, each containing tasks.

Each task (WorkTask) must have:
- id: descriptive ID like "m1-s1-t1"
- name: short name
- description: what to implement
- status: "pending"
- dependencies: array of task IDs this depends on
- touches: array of file paths this task writes to (must exist in codeTree)
- reads: array of file paths this task reads from (must exist in codeTree)
- worker: null
- tokenSpend: 0
- attemptCount: 0
- gateResults: []
- parentSliceId: the slice ID this task belongs to

Each slice (WorkSlice) must have:
- id: like "m1-s1"
- name: short name
- description: what this slice covers
- tasks: array of WorkTask
- parentMilestoneId: the milestone ID

Each milestone (WorkMilestone) must have:
- id: like "m1"
- name: short name
- description: what this milestone achieves
- slices: array of WorkSlice
- dependencies: array of milestone IDs

## CodeTree Structure

The codeTree has modules, each containing files.

Each file (CodeFile) must have:
- path: relative file path
- description: what this file does
- exports: array of { name, signature, description }
- imports: array of { from, names }
- lastModifiedBy: null

Each module (CodeModule) must have:
- path: directory path
- description: what this module does
- files: array of CodeFile

## Rules

- Every file path in task.touches and task.reads MUST exist in the codeTree
- Each task should be small enough to fit in one LLM context window
- Use descriptive IDs: m1, m1-s1, m1-s1-t1
- Group files into modules by top-level directory

Output ONLY a valid JSON object with "workTree" and "codeTree" keys. No markdown fences, no explanation.`;

  if (repoMap) {
    const landscape = buildLandscape(repoMap);
    base += `\n\nEXISTING CODEBASE:\n${JSON.stringify(landscape)}\n\nGenerate tasks that integrate with existing modules. Reuse existing patterns and utilities.`;
  }

  return base;
}

// === Response Parser ===

/**
 * Parse the AI response text, extracting a SeederOutput with workTree and codeTree.
 * Returns null if the response is invalid or missing required trees.
 */
export function parseSeederResponse(text: string): SeederOutput | null {
  try {
    // Try to find JSON in the text — the AI may wrap it in markdown fences
    let jsonStr = text.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object") return null;
    if (!("workTree" in parsed) || !("codeTree" in parsed)) return null;

    const workTree = parsed.workTree as WorkTree;
    const codeTree = parsed.codeTree as CodeTree;

    // Basic structural validation
    if (!workTree || !Array.isArray(workTree.milestones)) return null;
    if (!codeTree || !Array.isArray(codeTree.modules)) return null;

    return { workTree, codeTree };
  } catch {
    return null;
  }
}

// === SDK Call ===

/**
 * Call the Agent SDK to generate work and code trees from a specification.
 * Uses text-only generation (no tools) to produce structured JSON output.
 */
export async function seedFromSpec(
  specText: string,
  projectName: string,
  cwd: string,
  budgetUsd?: number,
  repoMap?: RepoMap | null,
): Promise<SeederOutput | null> {
  const prompt = buildSeederPrompt(specText, projectName, repoMap);

  const stream = query({
    prompt,
    options: {
      model: "claude-sonnet-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: budgetUsd ?? 1,
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

  if (!resultMsg) return null;
  if (resultMsg.subtype !== "success") return null;

  return parseSeederResponse(resultMsg.result);
}

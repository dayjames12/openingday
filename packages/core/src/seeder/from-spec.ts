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

## Task Description Format

Each task description MUST follow: "[Action] [what] in [file path] — [specific outputs]"
Keep descriptions under 200 chars. Workers receive compressed wire-mode prompts.

### Examples

GOOD: "Add GET /players endpoint in src/routes/players.ts — exports listPlayers(): Player[]"
GOOD: "Create JWT validation middleware in src/auth/jwt.ts — exports validateToken(token: string): Claims"
GOOD: "Add error boundary component in src/components/ErrorBoundary.tsx — catches render errors, shows fallback UI"

BAD: "Implement the API"
BAD: "Set up authentication"
BAD: "Handle errors"
BAD: Task generates types with fields not mentioned in the spec (adding email when spec says battingAvg)

## Acceptance Criteria

Each task MUST have 3+ concrete, testable acceptance criteria as part of its description. These should be verifiable without human judgment.

## Context Window Rule

Each task must fit in 150k tokens of context. If uncertain, split.

## WorkTree Structure

The workTree should have milestones, each containing slices, each containing tasks.

Each task (WorkTask) must have:
- id: descriptive ID like "m1-s1-t1"
- name: short name
- description: what to implement (follow format above)
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

RULE 1 — ONE OWNER PER FILE:
Every file has exactly one task that creates or modifies it. No exceptions. If a feature requires changes across an existing file that another task touches, those changes MUST be in the SAME task or the second task MUST depend on the first. Independent tasks MUST NOT share files in their touches arrays.

RULE 2 — TESTS LIVE WITH IMPLEMENTATION:
No separate testing milestone. Each implementation task MUST include test files in its touches array. The worker writes code AND tests in the same context. Tests always match implementation.

BAD:  Milestone 1: Build API -> Milestone 2: Write tests
GOOD: Task: "Create players route + tests" -> touches: [src/routes/players.ts, src/__tests__/players.test.ts]

RULE 3 — CONTRACTS FIRST:
First task of every project: generate a contracts file from the spec. Every subsequent task reads it. The contracts task touches only the contracts file and its test file.

Milestone 0: Foundation
  Task 0: Generate contracts (shared types from spec) -> touches: [src/contracts.ts]
  Task 1: Project scaffolding
Milestone 1: Implementation
  Task 2: Players route + tests (reads: src/contracts.ts)

RULE 4 — EXPLICIT INTEGRATION TASKS:
When a project has multiple packages (client + server, monorepo, etc.), generate an explicit integration verification task at the end:
  Task: "Wire client to server — verify types match, API shapes match, full build + test"

RULE 5 — DETAILED TASK DESCRIPTIONS:
Task descriptions MUST be specific with exact expectations including function names, return types, and behavior:

GOOD: "Create src/routes/players.ts exporting playersRouter (Router). GET / returns Player[] from store. POST / validates via validatePlayer(), adds to store, returns 201. Import Player from contracts.ts. Include tests in __tests__/players.test.ts: GET returns empty array, GET returns players after POST, POST validates required fields."

BAD: "Implement the players endpoint"

DOMAIN FIDELITY:
- Types and interfaces MUST match the spec's domain language exactly
- If spec says "player with name, team, battingAvg" -> generate EXACTLY those fields, not generic alternatives
- Do NOT substitute domain-specific fields with generic ones (no "email" when spec says "team")

MIDDLEWARE ORDER:
- Express middleware executes in registration order
- Static file serving MUST come before 404 catch-all handlers
- Route-specific handlers MUST come before generic error handlers

- Every file path in task.touches and task.reads MUST exist in the codeTree
- Each task must fit in 150k tokens of context. If uncertain, split.
- Use descriptive IDs: m1, m1-s1, m1-s1-t1
- Group files into modules by top-level directory
- Tasks touching the same file should have dependency relationships

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
export interface SeederWarning {
  taskId: string;
  message: string;
}

export function parseSeederResponse(text: string): { output: SeederOutput | null; warnings: SeederWarning[] } {
  const warnings: SeederWarning[] = [];

  try {
    // Try to find JSON in the text — the AI may wrap it in markdown fences
    let jsonStr = text.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object") return { output: null, warnings };
    if (!("workTree" in parsed) || !("codeTree" in parsed)) return { output: null, warnings };

    const workTree = parsed.workTree as WorkTree;
    const codeTree = parsed.codeTree as CodeTree;

    // Basic structural validation
    if (!workTree || !Array.isArray(workTree.milestones)) return { output: null, warnings };
    if (!codeTree || !Array.isArray(codeTree.modules)) return { output: null, warnings };

    // Validate tasks
    const allTasks: { id: string; description: string; touches: string[] }[] = [];
    for (const m of workTree.milestones) {
      for (const s of m.slices) {
        for (const t of s.tasks) {
          allTasks.push({ id: t.id, description: t.description, touches: t.touches });
        }
      }
    }

    // Build file-to-task map for conflict detection
    const fileTaskMap = new Map<string, string[]>();
    for (const task of allTasks) {
      if (task.description.length < 10) {
        warnings.push({ taskId: task.id, message: `Description too short (${task.description.length} chars)` });
      }
      if (task.touches.length === 0) {
        warnings.push({ taskId: task.id, message: "No files in touches" });
      }
      for (const f of task.touches) {
        const existing = fileTaskMap.get(f) ?? [];
        existing.push(task.id);
        fileTaskMap.set(f, existing);
      }
    }

    // Check for independent tasks touching the same file (no dependency between them)
    const taskDeps = new Map<string, Set<string>>();
    for (const m of workTree.milestones) {
      for (const s of m.slices) {
        for (const t of s.tasks) {
          taskDeps.set(t.id, new Set(t.dependencies));
        }
      }
    }

    for (const [file, taskIds] of fileTaskMap) {
      if (taskIds.length < 2) continue;
      for (let i = 0; i < taskIds.length; i++) {
        for (let j = i + 1; j < taskIds.length; j++) {
          const a = taskIds[i]!;
          const b = taskIds[j]!;
          const aDeps = taskDeps.get(a);
          const bDeps = taskDeps.get(b);
          if (!aDeps?.has(b) && !bDeps?.has(a)) {
            warnings.push({
              taskId: a,
              message: `Tasks ${a} and ${b} both touch ${file} with no dependency between them`,
            });
          }
        }
      }
    }

    return { output: { workTree, codeTree }, warnings };
  } catch {
    return { output: null, warnings };
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

  const { output } = parseSeederResponse(resultMsg.result);
  return output;
}

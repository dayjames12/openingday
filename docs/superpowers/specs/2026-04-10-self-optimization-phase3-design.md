# Phase 3: Orchestrator Split + Prompt Template System

## Problem

Self-optimization test: 8/22 tasks (36%). Failures cluster around:

1. **Orchestrator monolith (540 lines)** — too large for single worker to modify safely
2. **Prompts embedded in stage logic** — can't optimize prompts without touching execution code
3. **4 modules send prose to AI** — inconsistent framing, wasted tokens

## Goal

Make OD capable of self-improvement by breaking its largest files into worker-sized modules and centralizing all AI prompts behind wire-mode templates.

**Success metric:** Re-run self-optimization, target 14-16/22 tasks (65-73%).

---

## Part 1: Orchestrator Module Extraction

### Current State

`packages/core/src/orchestrator.ts` (540 lines) — single class containing:

- Cycle loop + spring training gate + budget/circuit-breaker checks
- Stage pipeline sequencing (implement → compile → test → review → gate → merge)
- Feedback loops (retry compile/test up to 5x with AI digestion)
- File content reading + truncation
- Cache invalidation + digest generation

### Target State

Split into 4 modules. Orchestrator becomes thin coordinator.

#### `orchestrator.ts` (~120 lines) — Coordinator

Responsibilities:

- Own the cycle loop (`runOneCycle`)
- Check terminal/paused status
- Run watchdog, circuit breakers, budget checks
- Trigger spring training (once, before first dispatch)
- Call `StagePipelineRunner` for each spawned task
- Update work tree with results
- Cache invalidation + digest generation (post-pipeline, stays here)

Does NOT contain: stage logic, file I/O, feedback loops, merge logic.

```typescript
// Simplified flow
async runOneCycle(): Promise<CycleResult> {
  const state = await this.storage.readProjectState();
  if (isTerminal(state)) return { done: true };

  this.watchdog.check(state);
  this.checkCircuitBreakers(state);
  this.checkBudget(state);

  if (!this.springTrainingDone) {
    await this.runSpringTraining();
  }

  const spawns = planSpawns(workTree, pool, config);
  const results = [];

  for (const task of spawns.tasksToSpawn) {
    const result = await this.pipelineRunner.run(task, context, config);
    results.push(result);
  }

  return { done: false, results };
}
```

#### `pipeline/stage-runner.ts` (~150 lines) — Stage Pipeline

Responsibilities:

- `run(task, context, config) → PipelineResult`
- Sequence: implement → compile → test → review → gate → merge
- Call `FeedbackLoopRunner` for compile/test stages
- Delegate to existing `stages/*` modules for actual execution
- Return per-stage outcomes

```typescript
export interface PipelineResult {
  taskId: string;
  stages: StageOutcome[];
  finalStatus: "completed" | "failed" | "partial";
  totalTokens: number;
}

export interface StageOutcome {
  stage: "implement" | "compile" | "test" | "review" | "gate" | "merge";
  passed: boolean;
  feedback?: StageFeedback;
  loopCount?: number;
}
```

#### `pipeline/feedback-loop.ts` (~80 lines) — Feedback Loop

Responsibilities:

- `runLoop(stage, task, context, config) → LoopResult`
- Retry stage up to `config.maxLoopIterations` times (default 5)
- Each iteration: run stage → digest AI feedback → respawn worker with feedback
- Track diff history for stuck detection (same diff 2x = bail)
- Record loop count and errors

```typescript
export interface LoopResult {
  passed: boolean;
  iterations: number;
  finalFeedback?: StageFeedback;
  stuckDetected: boolean;
}
```

#### `pipeline/file-reader.ts` (~50 lines) — File Content Reader

Responsibilities:

- `readFileContents(paths, options?) → Record<string, string>`
- Truncate large files: first 50 lines + export signatures + truncation notice
- Configurable truncation threshold (default 300 lines)

Currently buried in orchestrator lines 512-539. Extract as pure function.

### Testing Strategy

- `pipeline/stage-runner.test.ts` — unit test pipeline sequencing with mocked stages
- `pipeline/feedback-loop.test.ts` — unit test loop behavior, stuck detection
- `pipeline/file-reader.test.ts` — unit test truncation logic
- `orchestrator.test.ts` — becomes integration-only (full cycle with mocked storage)

### Migration

1. Extract `pipeline/file-reader.ts` first (no dependencies)
2. Extract `pipeline/feedback-loop.ts` (depends on stages, not orchestrator)
3. Extract `pipeline/stage-runner.ts` (depends on feedback-loop + stages)
4. Slim orchestrator to coordinator (imports pipeline runner)
5. All existing orchestrator tests must still pass

---

## Part 2: Prompt Template System

### Current State

AI prompts scattered across 5 modules, each building prompt strings inline:

| Module                         | Prompt type            | Wire mode?     |
| ------------------------------ | ---------------------- | -------------- |
| `workers/spawner.ts`           | Worker spawn           | Yes            |
| `stages/feedback.ts`           | Compile/test digestion | **No — prose** |
| `stages/review.ts`             | Code review            | **No — prose** |
| `spring-training/contracts.ts` | Contract extraction    | **No — prose** |
| `gates/quality.ts`             | Quality gate           | **No — prose** |

4 of 5 AI-facing modules use uncompressed prose. Inconsistent framing, wasted tokens.

### Target State

All prompts live in `prompts/` directory. Typed functions, wire-mode output, composable partials.

#### Directory Structure

```
packages/core/src/prompts/
  partials/
    role.ts          — agent role framing (shared across all prompts)
    output-format.ts — wire response schema + format instructions
    constraints.ts   — budget limits, safety rules, file boundaries
  worker.ts          — worker spawn prompt (migrate from spawner.ts)
  feedback.ts        — compile/test digestion (migrate from stages/feedback.ts)
  review.ts          — code review (migrate from stages/review.ts)
  contracts.ts       — contract extraction (migrate from spring-training/contracts.ts)
  quality.ts         — quality gate (migrate from gates/quality.ts)
```

#### Partials — Composable Building Blocks

```typescript
// prompts/partials/role.ts
export function agentRole(taskType: string): string {
  return `role:${taskType}|mode:wire|respond:json-only`;
}

// prompts/partials/output-format.ts
export function outputFormat(schema: string): string {
  return `out:{${schema}}|no-prose|no-markdown`;
}

// prompts/partials/constraints.ts
export function constraints(budget: number, safetyRules: string[]): string {
  return `budget:${budget}tok|rules:[${safetyRules.join(",")}]`;
}
```

#### Template Functions

Each template: typed args in, wire-compressed string out.

```typescript
// prompts/feedback.ts
import { agentRole, outputFormat, constraints } from "./partials/index.js";

export interface FeedbackPromptArgs {
  stage: "compile" | "test";
  rawOutput: string;
  taskName: string;
  filesChanged: string[];
  budget: number;
}

export function feedbackPrompt(args: FeedbackPromptArgs): string {
  return [
    agentRole(`${args.stage}-feedback`),
    `task:${args.taskName}`,
    `files:[${args.filesChanged.join(",")}]`,
    `raw:${args.rawOutput}`,
    outputFormat("issues:{file,line,msg,fix}[]"),
    constraints(args.budget, ["no-new-files", "preserve-exports"]),
  ].join("|");
}
```

#### Migration Plan

For each module:

1. Create prompt template in `prompts/`
2. Update source module to import and call template function
3. Remove inline prompt string from source module
4. Verify tests pass

Order (least dependencies first):

1. `prompts/partials/*` — shared building blocks
2. `prompts/contracts.ts` — standalone, used only by spring-training
3. `prompts/quality.ts` — standalone, used only by gates
4. `prompts/feedback.ts` — used by stages/feedback.ts
5. `prompts/review.ts` — used by stages/review.ts
6. `prompts/worker.ts` — used by workers/spawner.ts (already wire, just migrate location)

### Wire Mode Enforcement

After migration, all AI-to-AI communication goes through `prompts/*`. No module should build prompt strings inline. Enforced by:

- ESLint rule or grep check: no `Anthropic()` calls outside spawner/stages
- All `messages[].content` values come from `prompts/*` functions

---

## Scope Boundaries

**In scope:**

- Extract orchestrator into 4 modules
- Create prompt template system with partials
- Migrate all 5 prompt sources to templates
- Wire mode on all AI-to-AI prompts
- Tests for all new modules

**Out of scope:**

- Model tier selection, skills-enabled workers, quality intelligence (Phase 3.5 — depends on clean architecture from this phase)
- Storage changes (Phase 4)
- Wire compression algorithm changes (Phase 4)
- Performance benchmarks (Phase 4)
- Lambda/SST/cloud deploy (Phase 5, shelved)
- New features or behavior changes — pure refactor

## File Inventory

### New Files

- `packages/core/src/pipeline/stage-runner.ts`
- `packages/core/src/pipeline/stage-runner.test.ts`
- `packages/core/src/pipeline/feedback-loop.ts`
- `packages/core/src/pipeline/feedback-loop.test.ts`
- `packages/core/src/pipeline/file-reader.ts`
- `packages/core/src/pipeline/file-reader.test.ts`
- `packages/core/src/prompts/partials/role.ts`
- `packages/core/src/prompts/partials/output-format.ts`
- `packages/core/src/prompts/partials/constraints.ts`
- `packages/core/src/prompts/partials/index.ts`
- `packages/core/src/prompts/worker.ts`
- `packages/core/src/prompts/feedback.ts`
- `packages/core/src/prompts/review.ts`
- `packages/core/src/prompts/contracts.ts`
- `packages/core/src/prompts/quality.ts`

### Modified Files

- `packages/core/src/orchestrator.ts` — slim to ~120 lines, import pipeline runner
- `packages/core/src/orchestrator.test.ts` — keep as integration tests
- `packages/core/src/workers/spawner.ts` — import prompt from `prompts/worker.ts`
- `packages/core/src/stages/feedback.ts` — import prompt from `prompts/feedback.ts`
- `packages/core/src/stages/review.ts` — import prompt from `prompts/review.ts`
- `packages/core/src/spring-training/contracts.ts` — import prompt from `prompts/contracts.ts`
- `packages/core/src/gates/quality.ts` — import prompt from `prompts/quality.ts`
- `packages/core/src/index.ts` — export new modules

### Deleted Files

None — all changes are extractions + migrations.

## Risks

1. **Orchestrator refactor breaks integration tests** — mitigate by extracting bottom-up (file-reader first, orchestrator last) and running tests after each extraction
2. **Wire-mode prompts degrade AI output quality** — mitigate by testing each migrated prompt against current prose output before committing
3. **Prompt templates add indirection** — mitigate by keeping templates as plain functions, no runtime magic

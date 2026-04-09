# OpeningDay Quality Overhaul — Design Spec

**Date:** 2026-04-09
**Status:** Draft

## Overview

Overhaul OpeningDay's execution pipeline to prioritize quality, reliability, and robustness over speed. Replace one-shot blind workers with enriched context, staged feedback loops, strict contracts, and heavy plan validation. Prevent problems before dispatch instead of catching them after money is spent.

## Core Principle

Quality over speed. Spend $1 validating the plan to save $20 on failed workers. Every loop has kill switches. Every worker sees real code. Every type has one source of truth.

## 1. Spring Training — Plan Validation Before Execution

Heavy validation between seeding and first dispatch. Three phases.

### Phase A: Structural Validation (no AI, instant)

- Every file in `touches`/`reads` exists in code tree OR repo map
- No two independent tasks (no dependency chain) write to same file — **hard block, not warning**
- Dependency graph is a DAG (no cycles)
- Estimated context per task < 150k tokens
- Every task has description > 20 chars with file path
- Every milestone has at least one task
- Every implementation task includes test files in its `touches`

### Phase B: Contract Generation (AI, one-time)

Parse spec for domain entities. Generate shared contracts file committed to repo BEFORE any worker runs.

Output: `src/contracts.ts` (or project-appropriate path) containing:
- All domain interfaces/types referenced in spec
- Extracted from spec's domain language exactly (no generic substitution)
- For brownfield: existing types extracted + spec additions merged

Every subsequent task gets contracts file in `reads` automatically. Workers NEVER modify contracts. If a type change is needed, task fails → orchestrator re-runs spring training for that type.

### Phase C: Execution Plan Simulation (AI, one-time)

Walk through tasks in planned order:
- For each task: "given what previous tasks produce, does this task have enough context?"
- Flag missing dependency links (e.g., test task doesn't depend on implementation task)
- Flag tasks that write to files other tasks read without dependency
- Produce optimized execution order with added dependencies where needed
- Split tasks where conflicts detected
- User reviews simulation report before `run`

Cost: ~$1-2. Saves entire run from structural failures.

## 2. Staged Execution — Feedback Loops Per Task

Replace one-shot worker with multi-stage pipeline:

```
DISPATCH → IMPLEMENT → COMPILE → TEST → REVIEW → MERGE
              ↑            ↑         ↑        ↑
              └── fix ──────┘── fix ──┘── fix ──┘
```

### Stage 1: IMPLEMENT

Worker receives enriched context (see Section 3). Writes code in worktree.

### Stage 2: COMPILE

- Orchestrator runs `tsc --noEmit` in worktree
- If errors: AI digests into `[{file, line, error, fix_suggestion}]`
- Worker receives digest, fixes
- Loop until clean or safety cap

### Stage 3: TEST

- Orchestrator runs `{env.pm} test` in worktree
- If failures: AI digests into `[{test_name, expected, actual, file, line, root_cause}]`
- Worker receives digest, fixes
- If NO tests exist for task's code: feedback injected ("no tests found for src/routes/players.ts — write tests before proceeding")
- Loop until green or safety cap

### Stage 4: REVIEW

- Separate AI reviewer reads actual diff + contracts + spec
- Checks: domain fidelity, pattern consistency, no duplicate logic, proper imports, middleware order
- If issues: AI digest to worker, worker fixes
- Loop until approved or safety cap

### Stage 5: MERGE

Only after all stages pass. Merge worktree, generate task completion digest, refresh repo map.

### Feedback Format (AI-Digested)

All feedback to workers is wire-mode compressed:

```json
{"stage":"compile","errors":[{"f":"src/routes/players.ts","l":12,"e":"Property 'team' does not exist on type 'Player'","fix":"Import Player from contracts.ts, not local definition"}]}
```

Worker gets targeted, actionable feedback. Not raw 500-line tsc dump.

### Re-Evaluation at Max 5

At 5 loops in any stage, orchestrator stops and evaluates:
- AI analyzes full error history for task
- Decides: split into subtasks? provide more context? different approach?
- If auto-fixable: does it
- If not: flags for human review in dashboard

## 3. Worker Context Enrichment

Workers see real code, not just signatures.

### Context Package (Enriched)

| Context | Before | After |
|---------|--------|-------|
| Task description | ~200 chars | Full task spec + acceptance criteria |
| Contracts file | Didn't exist | Full source of shared types |
| Files being modified | Signatures `{n, sig}` | **Full file contents** |
| Dependency files | Signatures | **Full contents** for direct imports |
| Dependent files | Signatures | Signatures (don't modify these) |
| Repo landscape | Module names + keywords | Same |
| Previous task output | Nothing | AI-digested completion summaries |
| Spec excerpt | Nothing | Relevant spec section for this task |
| Memory | Institutional notes | Same + failure context from retries |

**Large file handling:** If file > 300 lines, include: first 50 lines + exports section + section around where changes go. Don't send entire 3000-line file.

**Wire mode still applies** to: landscape, dependency signatures, summaries. Only files being directly modified get full contents.

### Task Completion Digests

After each task merges, orchestrator generates wire-mode digest:

```json
{"task":"m2-s1-t1","did":"created GET /players in src/routes/players.ts","ex":["playersRouter"],"im":["Player from contracts","store"],"pattern":"Router, json array response, no wrapper"}
```

Stored in `.openingday/digests/`. All prior digests included in next worker's context.

## 4. Safety Nets — Kill Switches at Every Layer

### Per-Stage (innermost)

| Cap | Value | Action |
|-----|-------|--------|
| Max iterations | 5 | Re-evaluate |
| Same error consecutive | 3 | Break, re-evaluate |
| Wall-clock timeout | 10 min | Break, fail stage |
| Stage token budget | task_budget / 4 | Break, fail stage |
| Identical diff two loops | 2 | Stuck, break |

### Per-Task (middle)

| Cap | Value | Action |
|-----|-------|--------|
| Total token budget | $2 default | Fail task |
| Wall-clock timeout | 30 min | Fail task |
| Total stage loops combined | 15 | Fail task |
| Re-evaluations | 3 | Escalate to human |
| Loop IDs created | 50 | Hard kill task |

### Per-Project (outermost)

| Cap | Value | Action |
|-----|-------|--------|
| Project budget | $50 default | Hard kill |
| Consecutive task failures | 5 | Circuit breaker, pause |
| No-progress timeout | 40 min | Auto-pause |
| Total workers spawned | 50 | Stop dispatching |
| Manual kill | CLI/dashboard | Immediate stop |

### Global Watchdog Timer

Independent process-level check:
- No task completed in 20 min + workers active → log warning
- No task completed in 40 min + workers active → auto-pause project

Every loop has at least 2 independent kill conditions. No infinite loops possible.

## 5. Cross-Task Consistency

### Contracts File

Single source of truth for shared types. Generated in spring training. Workers read, never write. If type change needed → task fails → re-run spring training for that type.

### Task Completion Digests

Wire-mode summaries of what each completed task produced. Next worker sees all prior digests. Prevents: duplicate code, inconsistent patterns, missing imports.

### Milestone Integration Check

Between milestones:
1. Run `tsc` on full project (not just worktree)
2. Run full test suite
3. AI reviews: all modules integrate? Types consistent? No duplicate logic?
4. If issues: generate fix tasks, prepend to next milestone
5. If clean: proceed

For brownfield: also verify new code doesn't break existing tests.

## 6. Seeder Overhaul

### Rule 1: One Owner Per File

Every file has exactly one task that creates/modifies it. No exceptions. If feature requires changes across multiple existing files, those go in ONE task. Seeder validates before outputting.

### Rule 2: Tests Live With Implementation

No separate testing milestone. Each implementation task includes test files in `touches`. Worker writes code AND tests in same context. Tests always match implementation.

```
BAD:  Milestone 1: Build API → Milestone 2: Write tests
GOOD: Task: "Create players route + tests" → touches: [routes/players.ts, __tests__/players.test.ts]
```

### Rule 3: Contracts First

First task of every project: generate contracts file from spec. Every subsequent task reads it.

```
Milestone 0: Foundation
  Task 0: Generate contracts (shared types from spec)
  Task 1: Project scaffolding

Milestone 1: Implementation
  Task 2: Players route + tests (reads: contracts.ts)
  ...
```

### Rule 4: Explicit Integration Tasks

When project has client + server (or multiple packages), seeder generates explicit integration task:

```
Milestone N: Integration
  Task: "Wire client to server — verify types match, API shapes match, full build + test"
```

Not "hope it works." Explicit verification.

### Rule 5: Detailed Task Descriptions

Seeder descriptions specify exact expectations:

```
"Create src/routes/players.ts exporting playersRouter (Router).
GET / → return Player[] from store. POST / → validate via validatePlayer(), add to store, return 201.
Import Player from contracts.ts. Include tests in __tests__/players.test.ts:
GET returns empty array, GET returns players after POST, POST validates required fields."
```

## Revised Full Flow

```
Spec
  → Seed (smarter decomposition)
  → Spring Training:
      A: Structural validation (instant)
      B: Contract generation (AI, one-time)
      C: Execution simulation (AI, one-time)
  → User approves plan
  → Execute:
      For each task:
        Dispatch (enriched: contracts + digests + file contents + spec)
          → Implement
          → Compile (tsc loop, AI feedback, max 5, circuit breakers)
          → Test (test loop, AI feedback, max 5, circuit breakers)
          → Review (AI review loop, max 5, circuit breakers)
          → Merge + digest + repo map refresh
      At milestone boundary:
        → Full project tsc + test suite
        → AI integration review
        → Fix tasks if needed
  → Complete
```

Safety at every level. Quality at every stage. No blind workers. No type drift. No duplicate code.

## What Changes vs What's New

**New modules:**
- `packages/core/src/spring-training/` — structural validation, contract generation, execution simulation
- `packages/core/src/stages/` — compile, test, review stage runners with feedback loops
- `packages/core/src/stages/feedback.ts` — AI error digest generation
- `packages/core/src/digests/` — task completion digest generation and storage
- `packages/core/src/safety/watchdog.ts` — global watchdog timer

**Major modifications:**
- `orchestrator.ts` — replace single-pass with staged pipeline
- `context-builder.ts` — include full file contents, contracts, digests, spec excerpts
- `seeder/from-spec.ts` — enforce 6 rules, one-owner-per-file, tests-with-impl, contracts-first
- `wire/wire.ts` — WirePrompt gains full file contents field, digests field
- `types.ts` — new types for stages, digests, contracts, feedback
- `storage/` — new methods for digests, contracts, stage state
- `preflight/check.ts` — merge into spring training (more comprehensive)
- `gates/pipeline.ts` — becomes the review stage, integrated into staged flow

**Removed/replaced:**
- Separate "gate after merge" model → gates are now stages BEFORE merge
- Preflight as separate step → absorbed into spring training
- One-shot worker model → multi-stage with feedback

## Multi-Developer Note

Same as before: solo dev per branch. Feature branches coordinate via git. Multi-dev coordination deferred to Phase 4+.

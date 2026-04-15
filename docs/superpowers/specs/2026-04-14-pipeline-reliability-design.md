# Pipeline Reliability Overhaul

**Date**: 2026-04-14
**Status**: Approved
**Context**: Self-optimization test revealed 3 systemic pipeline failures causing 100% task failure rate on infra issues while burning tokens on unrecoverable retry loops.

## Problem Statement

Running OpeningDay on itself (6 tasks, Sonnet workers) produced 2/6 completions. The other 4 failed at the compile or review stage due to infrastructure issues, not code quality. Each failure spawned 3-5 retry loops (full agent sessions), burning tokens on problems the agent couldn't fix. The circuit breaker then tripped on "low efficiency," blocking retries that would have succeeded after infra fixes.

Three root causes:
1. Compile stage doesn't understand build tool diversity (Vite vs tsc)
2. Review stage mixes concerns (code quality + contract consistency) and has broken retry tracking
3. Circuit breaker can't distinguish infra failures from code failures

## Area 1: Compile Stage — Build Tool Awareness

### Goal
Compile stage only runs tsc on packages where tsc can actually work. Bundler-only packages (Vite, webpack) are skipped.

### Design

#### 1a. Per-package build config in repo map

New type:
```typescript
interface PackageBuildConfig {
  tscCompatible: boolean;
  bundler?: "vite" | "webpack" | "esbuild" | "rollup";
  moduleResolution?: string;
}
```

New field on `RepoMap`:
```typescript
packageConfigs?: Record<string, PackageBuildConfig>;
// key = relative package path, e.g. "packages/dashboard"
```

Detection during `scanRepo()`:
- For each directory under `packages/` (or workspace roots from pnpm-workspace.yaml)
- Read `tsconfig.json` → extract `compilerOptions.moduleResolution`
- If `"bundler"` → `tscCompatible: false`
- Read `package.json` → check `scripts.build` for vite/webpack/esbuild keywords → populate `bundler`
- If no tsconfig.json exists → `tscCompatible: false`

#### 1b. Compile stage pre-check

In `runTsc()`, before invoking tsc:
1. Determine target package from touched files (existing `detectPackageDir`)
2. Look up `PackageBuildConfig` from repo map
3. If `tscCompatible === false` → return `{ exitCode: 0, output: "skipped: bundler package" }`
4. Otherwise run tsc with `--project` as today

For multi-package changes (touched files span packages):
- Run tsc separately for each tsc-compatible package
- Skip bundler packages
- Aggregate results

#### 1c. Fallback: direct tsconfig read

If repo map lacks `packageConfigs` (old projects, manual init):
- Read `tsconfig.json` from the worktree package directory
- Check `compilerOptions.moduleResolution`
- If `"bundler"` → skip

### Files
- `packages/core/src/scanner/types.ts` — add `PackageBuildConfig`, extend `RepoMap`
- `packages/core/src/scanner/scan.ts` — detect per-package build config
- `packages/core/src/scanner/scan.test.ts` — test detection
- `packages/core/src/stages/compile.ts` — pre-check before tsc, fallback read, multi-package support
- `packages/core/src/stages/compile.test.ts` — test skip behavior
- `packages/core/src/pipeline/stage-runner.ts` — pass repo map to compile stage

## Area 2: Review Stage — Scoped to Diff, Contracts as Gate

### Goal
Review stage only evaluates whether the diff correctly implements the spec. Contract consistency is validated by a separate non-AI gate. Review retry accumulation is fixed so safety caps actually work.

### Design

#### 2a. Remove contracts from review prompt

In `reviewPrompt()`, remove the `contracts` parameter. The reviewer receives:
- `diff` — what code changed
- `specExcerpt` — what was requested

The reviewer's sole question: "does this diff correctly implement the spec?"

#### 2b. Contracts validation gate

New file `packages/core/src/gates/contracts-gate.ts`:

```typescript
function validateContracts(
  contractsSource: string,
  touchedFiles: string[],
  worktreePath?: string,
): GateResult
```

Non-AI validation:
1. Parse contracts file for `export` declarations (regex, not full AST)
2. Scan touched files for imports from contracts
3. Flag: declared exports with no consumers, imports referencing non-existent exports
4. Return `pass: true` if no blockers found

Added to the default gate pipeline in `packages/core/src/gates/pipeline.ts`.

Costs zero tokens — pure string matching.

#### 2c. Fix review retry accumulation

Current bug in `stage-runner.ts`: `shouldBreak()` receives a fresh tracker and empty diff history each time, so safety caps (`MAX_SAME_ERROR`, `MAX_IDENTICAL_DIFFS`) never trigger.

Fix:
- Create `LoopTracker` before the initial review call
- Maintain `errorHistory: StageFeedback[]` across both review runs
- Capture diff before each review run into `diffHistory: string[]`
- Pass accumulated state to `shouldBreak()` on the retry check

#### 2d. Update review call sites

- `runReviewStage()` signature drops `contracts` param
- All callers in `stage-runner.ts` updated
- `runReviewStage()` accepts `model` param (already done in model config work)

### Files
- `packages/core/src/prompts/review.ts` — remove contracts from template
- `packages/core/src/stages/review.ts` — drop contracts param from `runReviewStage`
- `packages/core/src/gates/contracts-gate.ts` — new file
- `packages/core/src/gates/contracts-gate.test.ts` — new file
- `packages/core/src/gates/pipeline.ts` — add contracts gate
- `packages/core/src/pipeline/stage-runner.ts` — fix retry accumulation, update review calls

## Area 3: Circuit Breaker — Failure Classification

### Goal
Circuit breaker distinguishes infrastructure failures from code failures. Infra failures don't count against efficiency. Repeated infra failures trigger a diagnostic pause instead of a generic "efficiency below threshold."

### Design

#### 3a. Failure metadata on WorkTask

New fields on `WorkTask`:
```typescript
failureStage?: "implement" | "compile" | "test" | "review" | "gate" | "merge";
failureKind?: "infra" | "code" | "budget" | "timeout";
failureMessage?: string;
```

Set by the orchestrator when marking a task as failed, based on `classifyFailure()` output.

#### 3b. Failure classification function

New file `packages/core/src/budget/classify.ts`:

```typescript
function classifyFailure(
  stageResults: StageResult[],
): { stage: string; kind: "infra" | "code" | "budget" | "timeout"; message: string }
```

Infra pattern matching against error strings in stage feedback:
- `Cannot find module` + file not in task's touched list → infra
- `ENOENT`, `symlink`, `Permission denied` → infra
- `must have setting "composite": true` → infra
- `--jsx is not set` on files the task didn't touch → infra
- Rate limit / API timeout from spawner error message → timeout
- Budget exceeded → budget
- Everything else → code

Edge case: if task fails at spawn (no stage results), classify as `timeout` with message from the spawn error. The orchestrator's catch block (line 361-369) already captures the error message — pass it to `classifyFailure` as a fallback.

Pure function. Tested with exact error strings from the self-optimization runs.

#### 3c. Updated circuit breakers

`checkCircuitBreakers()` changes:

**Efficiency breaker**: only counts `code` failures.
```
efficiency = completed / (completed + codeFailures)
// infra and timeout failures excluded from denominator
```

**Consecutive failures breaker**: streak resets on success OR on a different failure kind. Three identical `infra` failures in a row don't count toward the code failure streak.

**New infra breaker** (`checkInfraBreaker()`):
- If 2+ tasks failed with `failureKind: "infra"` and matching `failureMessage` pattern
- Pause with diagnostic: `"Infrastructure issue detected: {message}. Fix and resume."`
- This gives the user actionable information instead of "efficiency below threshold"

#### 3d. Orchestrator integration

On task failure:
```typescript
const classification = classifyFailure(pipeline.stageResults);
workTree = updateTask(workTree, task.id, {
  failureStage: classification.stage,
  failureKind: classification.kind,
  failureMessage: classification.message,
  attemptCount: (existing?.attemptCount ?? 0) + 1,
});
```

Memory log enriched: `"Task m1-s2-t3 failed [infra] at compile: Cannot find module 'express'"`.

### Files
- `packages/core/src/types.ts` — add failure fields to WorkTask
- `packages/core/src/budget/classify.ts` — new file
- `packages/core/src/budget/classify.test.ts` — new file
- `packages/core/src/budget/budget.ts` — update breakers, add `checkInfraBreaker`
- `packages/core/src/budget/budget.test.ts` — update tests
- `packages/core/src/orchestrator.ts` — persist classification, enrich memory

## Cross-Cutting: How They Work Together

```
Task dispatched
  → Compile: check PackageBuildConfig (Area 1)
    → bundler package? Skip tsc. No infra failure.
    → tsc-compatible? Run scoped tsc. Real compile errors only.
  → Test: unchanged
  → Review: diff + spec only (Area 2)
    → No contracts noise. Focused evaluation.
    → Retry with accumulated feedback history.
  → Gates: contracts gate validates types (Area 2)
    → Non-AI, zero tokens. Catches orphaned exports.
  → If fail: classifyFailure (Area 3)
    → infra? Don't count against efficiency. Log diagnostic.
    → code? Count normally. Breaker logic applies.
    → 2+ same infra failures? Pause with actionable message.
```

## File Change Summary

| File | Change |
|------|--------|
| `scanner/types.ts` | Add `PackageBuildConfig`, extend `RepoMap` |
| `scanner/scan.ts` | Detect per-package build config |
| `scanner/scan.test.ts` | Test detection |
| `stages/compile.ts` | Pre-check, skip bundler, multi-package, fallback tsconfig read |
| `stages/compile.test.ts` | Test skip behavior |
| `prompts/review.ts` | Remove contracts from template |
| `stages/review.ts` | Drop contracts param |
| `gates/contracts-gate.ts` | New: non-AI contract validation |
| `gates/contracts-gate.test.ts` | New: tests |
| `gates/pipeline.ts` | Add contracts gate |
| `pipeline/stage-runner.ts` | Fix review retry, pass repo map to compile, update review calls |
| `types.ts` | Add failure fields to WorkTask |
| `budget/classify.ts` | New: failure classification |
| `budget/classify.test.ts` | New: tests |
| `budget/budget.ts` | Update breakers, add infra breaker |
| `budget/budget.test.ts` | Update tests |
| `orchestrator.ts` | Persist classification, enrich memory |

17 files total (6 new, 11 modified).

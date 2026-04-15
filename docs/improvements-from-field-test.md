# Improvements from Field Test (2026-04-13)

Fixes based on running OpeningDay against a brownfield Remix/SST monorepo (17 tasks, 9 milestones).

## P0 Fixes (implemented)

### 1. Clean state on run exit
**Problem**: `run` left state as "running" on exit. Next `run` said "Already running" and blocked. Users needed a bash loop with manual state resets.

**Fix** (`packages/cli/src/commands/run.ts`):
- `finally` block now reads state and transitions "running" → "paused" on any exit
- Dry-run mode resets state before returning
- SIGTERM handler added alongside SIGINT — both call shared `gracefulShutdown()`

### 2. Seeder backfills code tree with planned new files
**Problem**: Spring training blocked on ALL new files. The seeder generates tasks that `touch` files that don't exist yet, but doesn't add them to the code tree. Every planned new file triggered "touch file X not found in code tree or repo map" blockers.

**Fix** (`packages/core/src/seeder/from-spec.ts`, `packages/cli/src/commands/init.ts`):
- New `backfillCodeTree(workTree, codeTree)` function iterates all task `touches` and `reads`
- For each file not in the code tree, adds a stub entry to the best-matching module (by longest path prefix)
- Called in `init.ts` after seeding, before writing the code tree to disk
- Exported from `@openingday/core` for use in other commands

### 3. Rate limit retry (429 backoff)
**Problem**: Worker hit 429 rate limit and immediately failed with `error_during_execution`. No retry, no backoff.

**Fix** (`packages/core/src/workers/spawner.ts`):
- Retry config changed from `{maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 5000}` to `{maxAttempts: 3, baseDelayMs: 30000, maxDelayMs: 120000}`
- 3 attempts with 30s base delay, exponential backoff to 120s max — matches Claude API rate limit windows

### 4. RTK integration for stage pipeline compression
**Problem**: Compile and test stages produce verbose output that gets fed to expensive AI digest calls. Each digest costs ~$0.05, and with retry loops across 18 tasks, digest costs alone can reach $9.

**Fix** (`packages/core/src/utils/rtk.ts`, `packages/core/src/stages/compile.ts`, `packages/core/src/stages/test.ts`):
- New `utils/rtk.ts` module: `isRtkAvailable()` (cached `which rtk` check), `wrapCommand()`, `rtkPrefix()`
- Compile stage (`runTsc`) prefixes `npx tsc --noEmit` with `rtk` when available
- Test stage (`runTests`) prefixes the test command with `rtk` when available
- Graceful fallback: if RTK is not installed, commands run unchanged
- Estimated 60-90% token reduction on stage output, reducing AI digest costs proportionally

## Remaining Issues (not yet fixed)

- **Workers waste tokens on "already done" tasks**: 5/13 workers read files and reported "already fully implemented" — need pre-spawn check
- **Dashboard cost mismatch**: Terminal `watch` and web dashboard show different costs
- **Contract generation empty on brownfield**: Workers lack shared types, spend tokens re-reading them
- **Repo scanner misses new subdirectories**: Scanner skipped entire `packages/core/src/euka/` directory until files were committed

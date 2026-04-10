```
      ⚾
   ___                 _           ___
  / _ \ _ __  ___ _ _ (_)_ _  __ _|   \ __ _ _  _
 | (_) | '_ \/ -_) ' \| | ' \/ _` | |) / _` | || |
  \___/| .__/\___|_||_|_|_||_\__, |___/\__,_|\_, |
       |_|                   |___/           |__/
```

**AI agent orchestration. Spec in. Code out.**

OpeningDay dispatches a roster of Claude Code workers through a tree of tasks — with staged quality loops, budget guardrails, and a supervisor keeping the game on track. Hand it a spec, watch it build.

---

## The Lineup

- **Spec-to-deploy lifecycle** — describe what you want, get a buildable codebase
- **Spring training** — plan validation before any code runs (structural check, contracts, simulation)
- **Staged quality pipeline** — compile → test → review loops with AI-digested feedback
- **Dual-tree architecture** — work tree (what to do) + code tree (what to build), linked at the file level
- **Parallel worker pool** — isolated git worktrees, compressed context, no idle token burn
- **Contracts file** — shared interface definitions generated at plan time, wired into every worker context
- **Cascading budgets** — project, milestone, slice, and task-level spend limits with circuit breakers
- **Live terminal dashboard** — 4-panel TUI with work tree, workers, gates, and cost tracking
- **Zero config auth** — uses your existing Claude Code credentials

## Quick Start

```bash
# Install
git clone <repo> && cd openingday
pnpm install && pnpm build

# Create an alias (add to .zshrc for persistence)
alias openingday="node $(pwd)/packages/cli/dist/index.js"
```

```bash
# Start a new project
mkdir my-app && cd my-app && git init && git commit --allow-empty -m "init"
openingday new
```

The interactive flow walks you through it:

```
? What are you building?
> A task management API with user auth and a React dashboard

? Tech stack?  SST Platform — SST v3, Hono, DynamoDB, Lambda
? Scale?       Medium — startup, ~10k users

Generating plan... ✓
Running spring training... ✓

Plan Summary
  Milestones: 2
  Tasks:      18
  Files:      34
  Contracts:  12

? Review the plan? Yes
```

Or go direct with a spec file:

```bash
openingday init --from spec.md --name my-app
openingday init --from . --spec add-billing.md    # existing repo + new feature
```

## Spring Training

Validates the plan before any code runs. Three phases:

1. **Structural check** — every task has files, every file has an owner, no orphans, no circular deps
2. **Contracts generation** — extracts shared interfaces, types, and API boundaries into a contracts file. Workers reference this instead of guessing at each other's signatures.
3. **Simulation** — dry-runs the dependency graph. Detects impossible orderings, resource conflicts, budget shortfalls.

```bash
openingday spring-training              # validate current plan
openingday spring-training --fix        # auto-fix structural issues
```

Spring training runs automatically during `new` and `init`. Run it manually after editing work/code trees.

## The Innings

```bash
# First pitch — start dispatching the roster
openingday run             # continuous until done
openingday run --step      # one task at a time
openingday run --dry-run   # preview without executing

# Spring training — validate before running
openingday spring-training

# Mid-game management
openingday pause           # graceful stop (workers finish current task)
openingday resume          # continue from where you left off
openingday kill            # pull the starter
```

## Quality Pipeline

Staged execution with feedback loops. Each stage retries up to 5 times with AI-digested error context before failing.

```
Worker implements → tsc check (loop) → test run (loop) → AI review (loop) → merge
```

**How it works:**

- **Compile stage** — runs `tsc`. On failure, AI digests the errors into actionable fixes, worker retries.
- **Test stage** — runs relevant tests. Failures get digested with context (which assertion, what expected vs actual).
- **Review stage** — AI reviews against project standards. Feedback digested into specific change requests.
- **Merge** — only after all three stages pass. Clean fast-forward into main worktree.

**Safety nets:**

- Max 5 loops per stage — circuit breaker trips on the 6th
- Watchdog timer per task — kills stuck workers
- Task completion digests — compressed learnings fed to subsequent workers
- Each retry gets the prior digest, not raw logs — keeps context windows tight

## The Scoreboard

```bash
openingday watch           # live terminal dashboard
openingday dashboard       # web UI at localhost:5173 (Vite dev), API at :3001
```

Note: generated apps may use port 3000 — no conflict with the dashboard.

```
┌─ Work Tree ──────────────────┬─ Active Workers ──────────────┐
│ M1: Core API                 │ W-1  task:auth-middleware  12s │
│   Auth [2/4]                 │ W-2  task:db-schema       8s  │
│     ✓ user-model             │ W-3  task:api-routes      3s  │
│     ✓ auth-middleware        │                               │
│     ⟳ session-handler        │                               │
│     ○ auth-tests             ├─ Gate History ────────────────┤
│   Database [1/3]             │ ✓ user-model     auto  0.2s  │
│     ✓ db-schema              │ ✓ auth-middleware gate  1.4s  │
│     ⟳ migrations             │ ✗ db-seed (retry 1)    0.8s  │
│     ○ seed-data              │                               │
│                              ├─ Budget ──────────────────────┤
│                              │ Spent: $4.20 / $50.00  (8%)  │
│                              │ Tasks: 6/18 complete          │
└──────────────────────────────┴───────────────────────────────┘
```

## The Dugout (Architecture)

```
SPEC → Spring Training → Seed Trees → Staged Dispatch → Quality Loops → Merge → Ship
```

**Dual Tree** — Two JSON trees drive the system:

- **Work Tree**: milestones → slices → tasks. Each task fits in one context window.
- **Code Tree**: modules → files → exports. Defines what code should exist.
- **The Link**: every task declares which files it `touches` and `reads`, enabling conflict detection.

**Contracts** — Shared interfaces extracted during spring training. Every worker gets the contracts file in its context package so cross-task boundaries stay consistent.

**Staged Execution** — compile → test → review, each with retry loops and AI-digested feedback. Workers never see raw error logs — digesters compress failures into actionable context that fits the window.

**The Roster** (workers) — Each task gets a fresh Claude Code session in an isolated git worktree. Workers receive compressed context (wire mode): task spec, contracts, relevant file contents, task digests from predecessors.

**The Skipper** (supervisor) — Wakes on schedule. Detects stuck workers, resets dead tasks, checks budgets, trips circuit breakers. One-way authority — supervisor controls workers, never reverse.

**Bullpen Budget** — Cascading limits: project → milestone → slice → task. Rate limiting, circuit breakers, hard kill on overspend.

## Project Structure

```
openingday/
├── packages/
│   ├── core/           # Types, trees, linker, state machine, workers,
│   │                   # gates, budget, orchestrator, spring training,
│   │                   # contracts, digesters, watchdog
│   ├── cli/            # Commander CLI — all commands
│   └── dashboard/      # Vite + React + Tailwind web UI
├── standards/          # Quality rule sets (base, aws-serverless)
├── tests/              # Integration tests
└── docs/               # Specs and design docs
```

State lives in `.openingday/` as JSON — no database, fully portable:

```
.openingday/
├── project.json        # config, budgets, limits
├── state.json          # status, token spend
├── work-tree.json      # milestones/slices/tasks
├── code-tree.json      # modules/files/interfaces
├── contracts.json      # shared interfaces from spring training
├── memory.md           # institutional knowledge
├── workers/            # per-task output logs + digests
├── gates/              # review results
└── supervisor/         # health check logs
```

## CLI Reference

| Command                               | Description                                     |
| ------------------------------------- | ----------------------------------------------- |
| `openingday new`                      | Interactive project creation                    |
| `openingday init --from <spec\|repo>` | CLI project init from spec or repo              |
| `openingday spring-training [--fix]`  | Validate plan: structure, contracts, simulation |
| `openingday run [--step] [--dry-run]` | Dispatch the roster (staged pipeline)           |
| `openingday pause`                    | Graceful stop                                   |
| `openingday resume`                   | Continue execution                              |
| `openingday kill`                     | Hard stop                                       |
| `openingday watch`                    | Live terminal dashboard                         |
| `openingday status [--cost]`          | Project state and spend                         |
| `openingday tree [--code]`            | Print work or code tree                         |
| `openingday dashboard [--port <n>]`   | Web dashboard (default: 5173)                   |

## Configuration

Edit `.openingday/project.json`:

```json
{
  "budgets": {
    "project": { "usd": 50, "warnPct": 70 },
    "perTask": { "usd": 2, "softPct": 75 },
    "supervisor": { "usd": 3 },
    "planning": { "usd": 5 }
  },
  "limits": {
    "maxConcurrentWorkers": 3,
    "maxTotalWorkers": 50,
    "maxRetries": 3,
    "maxLoopsPerStage": 5,
    "sessionTimeoutMin": 15
  },
  "circuitBreakers": {
    "consecutiveFailuresSlice": 3,
    "consecutiveFailuresProject": 5
  }
}
```

## Quality Standards

Standards are composable JSON rule sets in `standards/`:

```json
{
  "extends": ["base", "aws-serverless"],
  "rules": { "custom": ["my_rule_1"] }
}
```

Built-in: `base.json` (maintainability, testing, caching) and `aws-serverless.json` (Lambda, DynamoDB, IAM patterns).

## Development

```bash
pnpm install        # install deps
pnpm build          # build all packages
pnpm test           # run all tests (382)
pnpm typecheck      # TypeScript checks
pnpm lint           # ESLint
```

## Requirements

- Node.js 22+
- pnpm 9+
- Git (worktree isolation)
- Claude Code (uses your existing auth)

## License

MIT

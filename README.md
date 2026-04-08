```
      ⚾
   ___                 _           ___
  / _ \ _ __  ___ _ _ (_)_ _  __ _|   \ __ _ _  _
 | (_) | '_ \/ -_) ' \| | ' \/ _` | |) / _` | || |
  \___/| .__/\___|_||_|_|_||_\__, |___/\__,_|\_, |
       |_|                   |___/           |__/
```

**AI agent orchestration. Spec in. Code out.**

OpeningDay dispatches a roster of Claude Code workers through a tree of tasks — with gate-based quality checks, budget guardrails, and a supervisor keeping the game on track. Hand it a spec, watch it build.

---

## The Lineup

- **Spec-to-deploy lifecycle** — describe what you want, get a buildable codebase
- **Dual-tree architecture** — work tree (what to do) + code tree (what to build), linked at the file level
- **Parallel worker pool** — isolated git worktrees, compressed context, no idle token burn
- **Five-layer gate system** — typecheck, security, AI review, tree validation, optional human approval
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
      ⚾
   ___                 _           ___
  / _ \ _ __  ___ _ _ (_)_ _  __ _|   \ __ _ _  _
 | (_) | '_ \/ -_) ' \| | ' \/ _` | |) / _` | || |
  \___/| .__/\___|_||_|_|_||_\__, |___/\__,_|\_, |
       |_|                   |___/           |__/

  Spec in. Code out.  v0.1.0

? What are you building?
> A task management API with user auth and a React dashboard

? Tech stack?  SST Platform — SST v3, Hono, DynamoDB, Lambda
? Scale?       Medium — startup, ~10k users
? Requirements? Shopify webhook integration, Klaviyo for emails

Generating plan... ✓

Plan Summary
  Milestones: 2
  Tasks:      18
  Files:      34

? Review the plan? Yes
```

Or go direct with a spec file:

```bash
openingday init --from spec.md --name my-app
openingday init --from . --spec add-billing.md    # existing repo + new feature
```

## The Innings

```bash
# First pitch — start dispatching the roster
openingday run             # continuous until done
openingday run --step      # one task at a time
openingday run --dry-run   # preview without executing

# Mid-game management
openingday pause           # graceful stop (workers finish current task)
openingday resume          # continue from where you left off
openingday kill            # pull the starter
```

## The Scoreboard

```bash
openingday watch           # live terminal dashboard
openingday dashboard       # web UI at localhost:3000
```

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
SPEC ──▶ Seed Trees ──▶ Dispatch Roster ──▶ Gate Review ──▶ Advance ──▶ Ship
```

**Dual Tree** — Two JSON trees drive the system:
- **Work Tree**: milestones → slices → tasks. Each task fits in one context window.
- **Code Tree**: modules → files → exports. Defines what code should exist.
- **The Link**: every task declares which files it `touches` and `reads`, enabling conflict detection and impact analysis.

**The Roster** (workers) — Each task gets a fresh Claude Code session in an isolated git worktree. Workers receive a compressed context package (wire mode) with the task spec, relevant interfaces, and institutional memory. No idle token burn — workers exit when done.

**The Gates** — Five-layer quality pipeline after each worker:

| Layer | What | Tokens |
|-------|------|--------|
| Automated | typecheck, lint, tests | 0 |
| Security | dangerous pattern detection | 0 |
| Quality | AI review against standards | yes |
| Tree Check | changes match declared interfaces | yes |
| Human | optional approval for milestones | 0 |

**The Skipper** (supervisor) — Wakes on schedule. Detects stuck workers, resets dead tasks, checks budgets, trips circuit breakers. One-way authority — supervisor controls workers, never reverse.

**Bullpen Budget** — Cascading limits: project → milestone → slice → task. Rate limiting, circuit breakers, hard kill on overspend.

## Project Structure

```
openingday/
├── packages/
│   ├── core/           # Types, trees, linker, state machine, workers,
│   │                   # gates, budget, orchestrator, seeder
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
├── memory.md           # institutional knowledge
├── workers/            # per-task output logs
├── gates/              # review results
└── supervisor/         # health check logs
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `openingday new` | Interactive project creation |
| `openingday init --from <spec\|repo>` | CLI project init from spec or repo |
| `openingday run [--step] [--dry-run]` | Dispatch the roster |
| `openingday pause` | Graceful stop |
| `openingday resume` | Continue execution |
| `openingday kill` | Hard stop |
| `openingday watch` | Live terminal dashboard |
| `openingday status [--cost]` | Project state and spend |
| `openingday tree [--code]` | Print work or code tree |
| `openingday dashboard [--port <n>]` | Web dashboard |

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
pnpm test           # run all tests (251)
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

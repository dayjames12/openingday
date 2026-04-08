# OpeningDay

AI agent orchestration system. Give it a spec, it builds the app — dispatching Claude Code workers through a tree of tasks with gate-based quality checks and a supervisor for safety.

## Quick Start

```bash
# Install
git clone <repo> && cd openingday
pnpm install && pnpm build

# Create an alias (add to .zshrc for persistence)
alias openingday="node $(pwd)/packages/cli/dist/index.js"

# Uses your existing Claude Code auth — no API key needed
```
```

### 1. Create a Project (Interactive)

```bash
mkdir my-app && cd my-app && git init && git commit --allow-empty -m "init"

openingday new
```

This walks you through it conversationally:

```
⚾ Welcome to OpeningDay.

? What are you building?
> A task management API with user auth and a React dashboard

? Tech stack:
  ❯ SST Platform — SST v3, Hono, DynamoDB, Lambda, SNS/SQS, CloudFront
    Next.js — Next.js App Router, React, TypeScript, Tailwind
    Express API — Express, TypeScript, PostgreSQL/DynamoDB
    Remix — Remix, React, TypeScript, Tailwind
    Custom — describe your own

? Scale: medium (startup, ~10k users)

? Any specific requirements? (optional)
> Need Shopify webhook integration and Klaviyo for emails

Generating plan... ✓

  2 milestones, 6 slices, 18 tasks
  34 files planned
  Estimated cost: ~$14

? Review the plan? Yes
```

**Or use the CLI directly** if you already have a spec:

```bash
openingday init --from spec.md --name my-app
openingday init --from . --spec add-billing.md    # existing repo + new feature
```

### 2. Run Agents

```bash
openingday run             # continuous — dispatches workers until done
openingday run --step      # one task at a time

# Control
openingday pause           # graceful stop (workers finish current task)
openingday resume          # continue
openingday kill            # hard stop
```

### 3. Watch Progress

```bash
# Live terminal dashboard (no browser needed)
openingday watch

# Or in a browser
openingday dashboard       # opens http://localhost:3000
```

The terminal dashboard shows a live 4-panel view right in your terminal — work tree, active workers, gate history, and costs. Auto-refreshes every 2 seconds.

## How It Works

```
SPEC → Seed Trees → Dispatch Workers → Gate Review → Advance → Done
```

**The Dual Tree** — Two JSON trees drive the system:
- **Work Tree**: milestones → slices → tasks. Each task fits in one context window.
- **Code Tree**: modules → files → exports. Defines what code should exist.
- **The Link**: Every task declares which files it `touches` (writes) and `reads`. This enables conflict detection, gate review, and impact analysis.

**Workers** — Each task gets a fresh Claude Code session in an isolated git worktree. The worker receives a compressed context package (wire mode) with the task, relevant interfaces, and institutional memory. No idle token burn — workers die when done.

**Gates** — Five-layer quality pipeline runs after each worker:
1. **Automated** — typecheck, lint, tests (no AI, no tokens)
2. **Security** — dangerous pattern detection
3. **Quality** — AI-powered review against configurable standards
4. **Tree Check** — verifies changes match declared interfaces
5. **Human** — optional approval for critical milestones

**Supervisor** — Wakes on schedule. Detects stuck workers, resets dead tasks, checks budgets, trips circuit breakers. One-way authority — supervisor controls workers, never reverse.

**Billing Guardrails** — Cascading budgets (project → milestone → slice → task), rate limiting, circuit breakers, hard kill on overspend.

## Project Structure

```
openingday/
├── packages/
│   ├── core/           # Brain — types, trees, linker, state machine,
│   │                   #   workers, gates, budget, orchestrator, seeder
│   ├── cli/            # CLI — init, run, pause, resume, kill, status, tree, dashboard
│   └── dashboard/      # Web UI — Vite + React + Tailwind, 4-panel live view
├── standards/          # Quality rule sets (base.json, aws-serverless.json)
├── tests/              # Integration tests
└── docs/               # Specs and plans
```

## State on Disk

All state lives in `.openingday/` as JSON files:

```
.openingday/
├── project.json        # config, budgets, limits
├── state.json          # project status, token spend
├── work-tree.json      # milestones/slices/tasks
├── code-tree.json      # modules/files/interfaces
├── memory.md           # institutional knowledge
├── workers/            # per-task output logs
├── gates/              # review results per task
└── supervisor/         # health check logs
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `openingday new` | Interactive project creation (recommended) |
| `openingday init --from <spec\|repo> [--spec <file>] [--name <name>]` | CLI project init |
| `openingday run [--step] [--dry-run]` | Start dispatching workers |
| `openingday pause` | Graceful stop |
| `openingday resume` | Continue execution |
| `openingday kill` | Hard stop |
| `openingday watch` | Live terminal dashboard |
| `openingday status [--cost]` | Show project state |
| `openingday tree [--code]` | Print work or code tree |
| `openingday dashboard [--port <n>]` | Launch web dashboard (browser) |

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
    "maxTaskDepth": 4,
    "sessionTimeoutMin": 15,
    "spawnRatePerMin": 5
  },
  "circuitBreakers": {
    "consecutiveFailuresSlice": 3,
    "consecutiveFailuresProject": 5,
    "budgetEfficiencyThreshold": 0.5
  }
}
```

## Quality Standards

Standards are JSON rule sets in `standards/`. Projects can extend and compose them:

```json
{
  "name": "my-project",
  "extends": ["base", "aws-serverless"],
  "rules": {
    "custom": ["my_rule_1", "my_rule_2"]
  }
}
```

Built-in: `base.json` (maintainability, scalability, caching, testing), `aws-serverless.json` (Lambda, DynamoDB, IAM patterns).

## Development

```bash
pnpm install        # install deps
pnpm test           # run all tests (229)
pnpm typecheck      # TypeScript checks
pnpm lint           # ESLint
pnpm build          # build all packages
```

## Requirements

- Node.js 22+
- pnpm 9+
- Git (for worktree isolation)
- Claude Code (uses your existing auth — no API key needed)

## License

MIT

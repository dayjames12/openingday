# OpeningDay

AI agent orchestration system. Give it a spec, it builds the app — dispatching Claude Code workers through a tree of tasks with gate-based quality checks and a supervisor for safety.

## Quick Start

```bash
# Install
git clone <repo> && cd openingday
pnpm install
pnpm build

# Create an alias (add to .zshrc for persistence)
alias openingday="node $(pwd)/packages/cli/dist/index.js"
```

### 1. Initialize a Project

```bash
mkdir my-app && cd my-app && git init && git commit --allow-empty -m "init"

# From a spec file (AI generates the task tree)
openingday init --from spec.md --name my-app

# From an existing repo (scans code, you provide spec for new work)
openingday init --from . --spec add-billing.md --name my-app

# Inspect what was generated
openingday tree              # work tree (milestones/slices/tasks)
openingday tree --code       # code tree (modules/files/exports)
openingday status            # project state
openingday status --cost     # budget breakdown
```

### 2. Run Agents

```bash
# Start the orchestration loop
openingday run

# Or step through one task at a time
openingday run --step

# Control
openingday pause             # graceful stop (workers finish current task)
openingday resume            # continue
openingday kill              # hard stop
```

### 3. Watch Progress

```bash
# Terminal
openingday status

# Web dashboard
openingday dashboard
# Opens http://localhost:3000 with live 4-panel view
```

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
| `openingday init --from <spec\|repo> [--spec <file>] [--name <name>]` | Initialize project, seed trees |
| `openingday run [--step] [--dry-run]` | Start dispatching workers |
| `openingday pause` | Graceful stop |
| `openingday resume` | Continue execution |
| `openingday kill` | Hard stop |
| `openingday status [--cost]` | Show project state |
| `openingday tree [--code]` | Print work or code tree |
| `openingday dashboard [--port <n>]` | Launch web dashboard |

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
- `ANTHROPIC_API_KEY` environment variable

## License

MIT

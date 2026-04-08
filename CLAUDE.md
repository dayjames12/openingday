# CLAUDE.md

## Build & Development Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm test                 # Run all tests (vitest)
pnpm typecheck            # TypeScript checks
pnpm lint:fix             # ESLint with auto-fix
pnpm format               # Prettier write
```

## Architecture Overview

AI agent orchestration system -- tree-based task decomposition with review loops. Spec to code to deploy.

### Workspace Packages (`packages/`)

- **`@openingday/core`** -- Types, trees (work + code), linker, wire mode, context builder, state machine, worker pool, gates, budget. All pure functions, immutable data structures.
- **`@openingday/cli`** -- Commander-based CLI. Commands: init, status, tasks.

### Key Patterns

- **Immutable updates**: All tree operations take a tree and return a new tree
- **Package exports**: Wildcard `"./*"` mapping -- import as `@openingday/core/trees/work-tree`
- **Tests**: Vitest, co-located as `*.test.ts` next to source files. Integration tests in `tests/`.

## Git Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

### Commit Format

```
<type>[optional scope]: <description>

[optional body]
```

### Types

- `feat` - New features
- `fix` - Bug fixes
- `docs` - Documentation changes
- `chore` - Maintenance, dependencies, config
- `refactor` - Code restructuring without behavior change
- `test` - Adding or updating tests

### Rules

- Use imperative mood ("add feature" not "added feature")
- First line: `type(scope): description` (72 chars or less)
- No co-author lines in commits
- No model name references in commits or PR bodies
- No attribution/generated-by lines in PRs
- Break commits by logical functionality, not by file

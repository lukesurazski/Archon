## Project Overview

**Remote Agentic Coding Platform**: Control AI coding assistants (Claude Code SDK, Codex SDK) remotely from Slack, Telegram, GitHub, CLI, and Web. Built with **Bun + TypeScript + SQLite/PostgreSQL**. Single-developer tool — no multi-tenant complexity.

Platform-agnostic: adapters implement `IPlatformAdapter` and stream AI responses to all platforms in real time.

## Deep-Dive Docs

Load these on demand — they are not auto-included.

- `.claude/docs/architecture-deep-dive.md` — end-to-end data flow across packages, with file:line refs
- `.claude/docs/adapter-implementation-guide.md` — building / debugging platform adapters
- `.claude/docs/isolation-and-worktree-guide.md` — worktree lifecycle, resolution algorithm
- `.claude/docs/workflow-yaml-reference.md` — every YAML field, node type, variable, option
- `.claude/docs/cli-reference.md` — `bun run cli` command catalog
- `.claude/docs/database-schema.md` — 9 tables, conversation ID formats, session transitions
- `.claude/docs/development-patterns.md` — logging, error handling, SDK types, in-worktree self-testing, `.archon/config.yaml`, directory layouts

For runtime reference: the OpenAPI spec at `GET /api/openapi.json` is the source of truth for all REST endpoints. Use `bun run cli --help` for live CLI flags.

## Engineering Principles

Implementation constraints, not slogans. Apply by default.

**KISS** — Prefer straightforward control flow, explicit branches, typed interfaces. Keep error paths obvious and localized.

**YAGNI** — Do not add config keys, interface methods, feature flags, or workflow branches without a concrete accepted use case. No speculative abstractions without a current caller. Keep unsupported paths explicit (error out) rather than partial fake support.

**DRY + Rule of Three** — Duplicate small, local logic when it preserves clarity. Extract shared utilities only after the same pattern appears at least three times and has stabilized.

**SRP + ISP** — One concern per module. Extend behavior by implementing existing narrow interfaces (`IPlatformAdapter`, `IAgentProvider`, `IDatabase`, `IWorkflowStore`). Avoid fat interfaces. Do not add unrelated methods to an existing interface — define a new one.

**Fail Fast + Explicit Errors** — Silent fallback in agent runtimes can create unsafe or costly behavior. Throw early with a clear error for unsupported or unsafe states. Never silently broaden permissions or capabilities. Document intentional fallbacks with a comment; otherwise throw.

**No Autonomous Lifecycle Mutation Across Process Boundaries** — When a process cannot reliably distinguish "actively running elsewhere" from "orphaned by a crash" (because work was started by a different process: CLI, adapter, webhook, web UI, cron), it must not autonomously mark that work failed/cancelled/abandoned based on a timer. Surface the ambiguous state to the user with a one-click action. Heuristics for *recoverable* operations (retry backoff, subprocess timeouts, hygiene cleanup of terminal-status data) remain appropriate. Reference: #1216 and the CLI orphan-cleanup precedent at `packages/cli/src/cli.ts:256-258`.

**Determinism + Reproducibility** — Reproducible commands, locked dependency behavior in CI-sensitive paths. Deterministic tests — no flaky timing or network dependence without guardrails. `bun run validate` must map directly to CI.

**Reversibility + Rollback-First** — Small scope, clear blast radius. For risky changes, define the rollback path before merging. Avoid mixed mega-patches that block safe rollback.

## Type Safety (CRITICAL)

- Strict TypeScript config enforced
- Complete type annotations on all functions
- No `any` without explicit justification
- Interfaces for all major abstractions

## Zod Schema Conventions

- Schema naming: camelCase, descriptive suffix (e.g., `workflowRunSchema`, `errorSchema`)
- Type derivation: always `z.infer<typeof schema>` — never hand-craft parallel interfaces
- Import `z` from `@hono/zod-openapi`, not `zod` directly
- API routes use `registerOpenApiRoute(createRoute({...}), handler)` — the local wrapper handles the TypedResponse bypass
- Route schemas: `packages/server/src/routes/schemas/` (one file per domain)
- Engine schemas: `packages/workflows/src/schemas/` (one file per concern; `index.ts` re-exports); camelCase names
- `TRIGGER_RULES` and `WORKFLOW_HOOK_EVENTS` are derived from schema `.options` — never duplicate as a plain array. Exception: `@archon/web` must define a local constant since `api.generated.d.ts` is type-only and cannot export runtime values.
- `loader.ts` uses `dagNodeSchema.safeParse()` for node validation; graph-level checks (cycles, deps, `$nodeId.output` refs) stay imperative in `validateDagStructure()`

## Git Workflow and Releases

- `main` is the release branch — **never commit directly to `main`**.
- `dev` is the working branch. Feature work branches off `dev` and merges back into `dev`.
- For this checkout: `origin` is the fork (`lukesurazski/Archon`), `upstream` is canonical (`coleam00/archon`).
- **`upstream` is read-only by default.** Do not open PRs, push branches, or perform GitHub write actions against `upstream` unless the user explicitly says so.
- Default all GitHub writes to `origin` (the fork).
- Before any `gh pr create` step, state the exact target in one line and **wait for confirmation**:
  `Creating PR: merge <head-branch> into <owner>/<repo>/<base-branch>`
- All PRs must use `.github/PULL_REQUEST_TEMPLATE.md` — fill every section. `gh pr create` does NOT auto-apply the template; copy it into `--body` explicitly.
- Link the issue with `Closes #<n>` (or `Fixes`/`Resolves`) so it auto-closes on merge.
- To release: use the `/release` skill (compares `dev` to `main`, generates changelog, bumps version, opens PR). SemVer: `/release` (patch), `/release minor`, `/release major`.
- Changelog: `CHANGELOG.md`, Keep a Changelog format. Version: single `version` field in root `package.json`.

## Git as a First-Class Citizen

- Let git handle conflicts, uncommitted changes, and branch management.
- Surface git errors for actionable issues; handle expected failures (missing dirs during cleanup) gracefully.
- Trust git's natural guardrails (e.g., refuse to remove a worktree with uncommitted changes).
- Use `@archon/git` functions; when calling git directly, use `execFileAsync` (not `exec`).
- Worktrees enable parallel development per conversation without branch conflicts. Workspaces sync with origin before worktree creation.
- **NEVER run `git clean -fd`** — it permanently deletes untracked files. Use `git checkout .` instead.

## Essential Commands

```bash
bun run dev                # Server + Web UI together (hot reload)
bun run dev:server         # Backend only (port 3090)
bun run dev:web            # Frontend only (port 5173)
bun run test               # All tests, per-package isolated processes
bun run validate           # check:bundled, check:bundled-skill, type-check, lint, format, tests — REQUIRED before PR
bun run type-check
bun run lint               # and lint:fix
bun run format             # and format:check
```

Regenerating frontend API types (server must be running on 3090):

```bash
bun --filter @archon/web generate:types
```

Optional PostgreSQL (otherwise SQLite auto-initializes at `~/.archon/archon.db`):

```bash
docker-compose --profile with-db up -d postgres
# Then set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remote_coding_agent in .env
psql $DATABASE_URL < migrations/000_combined.sql
```

CLI catalog: see `.claude/docs/cli-reference.md` or `bun run cli --help`.

## Testing

- Unit tests for pure functions (variable substitution, command parsing).
- Integration tests for DB operations (real test DB) and end-to-end flows (mock platforms/AI, real orchestrator). Clean up after each test.

**Test isolation — `mock.module()` is process-global and irreversible.** `mock.restore()` does NOT undo it ([oven-sh/bun#7823](https://github.com/oven-sh/bun/issues/7823)).

- Do NOT add `afterAll(() => mock.restore())` for `mock.module()` — it has no effect.
- For internal modules that other test files import directly, use `spyOn()` — `spy.mockRestore()` DOES work for spies.
- Never `mock.module()` a module path that another test file also `mock.module()`s differently.
- Packages with conflicting mocks split tests across multiple `bun test` invocations: `@archon/core` (7), `@archon/workflows` (5), `@archon/adapters` (3), `@archon/isolation` (3). See each package's `package.json`.

**Do NOT run `bun test` from the repo root** — it discovers all test files and runs them in one process, causing ~135 mock pollution failures. Always use `bun run test` (which uses `bun --filter '*' test` for per-package isolation).

Manual validation: use the web API (curl) or CLI commands directly. See `.claude/docs/development-patterns.md` for in-worktree self-testing.

## ESLint

**Zero-tolerance**: CI enforces `--max-warnings 0`.

Inline `// eslint-disable-next-line` is **almost never** acceptable. Fix the issue instead. Only acceptable when:
1. External SDK types are incorrect (document which SDK and why)
2. Intentional type assertion after validation (comment must explain the validation)

**Never acceptable:** disabling `no-explicit-any` without justification, disabling rules to "make CI pass", or file-level `/* eslint-disable */`.

## Slash Commands (orchestrator)

The orchestrator treats only these top-level commands as deterministic (no AI):

`/help`, `/status`, `/reset`, `/workflow`, `/register-project`, `/update-project`, `/remove-project`, `/commands`, `/init`, `/worktree`

`/workflow` subcommands: `list`, `run`, `status`, `cancel`, `resume`, `abandon`, `approve`, `reject`.

For workflow YAML syntax, node types, variables, see `.claude/docs/workflow-yaml-reference.md`.

## Package Layout

Top-level monorepo (Bun workspaces):

- **`paths/`** — path resolution, Pino logger factory; zero `@archon/*` deps
- **`git/`** — git operations (worktrees, branches, exec wrappers); depends only on `paths`
- **`providers/`** — AI agent providers (Claude, Codex, Pi community); owns SDK deps and `IAgentProvider`. `@archon/providers/types` is the contract subpath (zero SDK deps) imported by `workflows`
- **`isolation/`** — worktree isolation; depends on `git` + `paths`
- **`workflows/`** — workflow engine (loader, router, executor, DAG); depends on `git` + `paths` + `providers/types` + zod
- **`core/`** — business logic, DB, orchestrator; depends on `providers`. Provides `createWorkflowStore()` bridging core DB → `IWorkflowStore`
- **`adapters/`** — Slack, Telegram, GitHub, Discord; depends on `core`
- **`cli/`** — CLI; depends on `server` + `adapters` for the serve command
- **`server/`** — OpenAPIHono HTTP server (Zod + OpenAPI spec via `@hono/zod-openapi`), Web adapter (SSE), API routes, Web UI static serving
- **`web/`** — React + Vite + Tailwind v4 + shadcn/ui + Zustand. SSE to server. `DagNode`, `WorkflowDefinition`, `WorkflowRunStatus` derive from `src/lib/api.generated.d.ts` (generated via `bun generate:types`) — **never import from `@archon/workflows`**

For full file:line details and data-flow traces, see `.claude/docs/architecture-deep-dive.md`.

## Import Patterns

**Always typed imports. Never `import *` for the main package.**

```typescript
// ✅ Type-only
import type { IPlatformAdapter, Conversation, MergedConfig } from '@archon/core';
// ✅ Named values
import { handleMessage, ConversationLockManager, pool } from '@archon/core';
// ✅ Namespace imports for submodules with many exports
import * as conversationDb from '@archon/core/db/conversations';
import * as git from '@archon/git';
// ✅ Workflow engine via direct subpaths
import type { WorkflowDeps } from '@archon/workflows/deps';
import type { IWorkflowStore } from '@archon/workflows/store';
import { executeWorkflow } from '@archon/workflows/executor';
import { discoverWorkflowsWithConfig } from '@archon/workflows/workflow-discovery';
import { findWorkflow } from '@archon/workflows/router';

// ❌ Never
import * as core from '@archon/core';
// ❌ Never in @archon/web — it's a server package
import type { DagNode } from '@archon/workflows/schemas/dag-node';
// ✅ In @archon/web, use re-exports from api.ts (derived from OpenAPI)
import type { DagNode, WorkflowDefinition } from '@/lib/api';
```

## Webhooks & Security

- GitHub webhook signature verification is required (HMAC SHA-256, `X-Hub-Signature-256`). Use `c.req.text()` for the raw body.
- Never log or expose tokens in responses.
- @mention detection: parse `@archon` in issue/PR **comments only** (not descriptions). See `.claude/docs/development-patterns.md` for the rationale (#96).

## When Creating New Features

- **Platform adapters**: implement `IPlatformAdapter`, handle auth, polling or webhooks
- **AI providers**: implement `IAgentProvider`, manage sessions, stream
- **Slash commands**: add to `command-handler.ts`, update DB, no AI
- **DB operations**: use the `IDatabase` interface (works for both PostgreSQL and SQLite adapters)

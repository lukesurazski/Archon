# Development Patterns

> **Purpose**: Concrete code patterns and configuration examples for working in the Archon codebase: logging, error handling, SDK types, in-worktree self-testing, and `.archon/config.yaml`.
> **When to use**: Writing new code that touches these areas or onboarding to the codebase.
> **Size**: ~200 lines — medium, scan the section you need.

## Structured Logging (Pino)

Logger factory lives at `packages/paths/src/logger.ts`.

```typescript
import { createLogger } from '@archon/paths';

const log = createLogger('orchestrator');

async function createSession(conversationId: string, codebaseId: string) {
  log.info({ conversationId, codebaseId }, 'session.create_started');
  try {
    const session = await doCreate();
    log.info({ conversationId, codebaseId, sessionId: session.id }, 'session.create_completed');
    return session;
  } catch (e) {
    const err = e as Error;
    log.error(
      { conversationId, error: err.message, errorType: err.constructor.name, err },
      'session.create_failed',
    );
    throw err;
  }
}
```

**Event naming rules:**
- Format: `{domain}.{action}_{state}` — e.g. `workflow.step_started`, `isolation.create_failed`
- Standard states: `_started`, `_completed`, `_failed`, `_validated`, `_rejected`
- Avoid generic events like `processing` or `handling`
- Always pair `_started` with `_completed` or `_failed`
- Include context: IDs, durations, error details

**Log levels:** `fatal` > `error` > `warn` > `info` (default) > `debug` > `trace`

**Never log:** API keys or tokens (mask as `token.slice(0, 8) + '...'`), user message content, PII.

## Error Handling

### Database errors

```typescript
// INSERT
try {
  await db.query('INSERT INTO conversations ...', params);
} catch (error) {
  log.error({ err: error, params }, 'db_insert_failed');
  throw new Error('Failed to create conversation');
}

// UPDATE — IDatabase update methods throw if no rows matched, surfacing missing records
try {
  await db.updateConversation(conversationId, { codebase_id: codebaseId });
} catch (error) {
  log.error({ err: error, conversationId }, 'db_update_failed');
  throw error;
}
```

### Git / isolation errors (don't fail silently)

Use `classifyIsolationError()` from `@archon/isolation` to map git errors (permission denied, timeout, no space, not a git repo) to user-friendly messages. Always log the raw error and send a classified message to the user.

```typescript
try {
  // ... isolation creation logic ...
} catch (error) {
  const err = error as Error;
  const userMessage = classifyIsolationError(err);
  log.error({ err, codebaseId, codebaseName }, 'isolation_creation_failed');
  await platform.sendMessage(conversationId, userMessage);
}
```

## SDK Type Patterns

Prefer importing and using SDK types directly:

```typescript
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

const options: Options = {
  cwd,
  permissionMode: 'bypassPermissions',
};
const message = msg as { message: { content: ContentBlock[] } };
```

Do NOT duplicate SDK types into your own interfaces — it forces `as any` casts and breaks on SDK updates.

## Running the App in a Worktree (self-testing)

Agents working in a worktree can run the full app and self-test (change → run → curl → fix). Ports are auto-allocated.

```bash
bun dev &
# [Hono] Worktree detected (/path/to/worktree)
# [Hono] Auto-allocated port: 3637 (base: 3090, offset: +547)
```

Test via the web API (production code path):

```bash
# Create a conversation
curl -X POST http://localhost:3637/api/conversations \
  -H "Content-Type: application/json" -d '{}'

# Send a message
curl -X POST http://localhost:3637/api/conversations/<id>/message \
  -H "Content-Type: application/json" -d '{"message":"/status"}'

# Fetch messages (polling) — SSE alternative at /api/stream/<id>
curl http://localhost:3637/api/conversations/<id>/messages
```

**Port allocation:**
- Worktrees: deterministic hash-based port in 3190–4089
- Main repo: 3090
- Override: `PORT=4000 bun dev`

**Notes:**
- Use the web API for manual validation — avoids running multiple platform adapters
- Database is shared with the main checkout
- Kill the server when done: `pkill -f "bun.*dev"` (or kill the specific port)

## `.archon/config.yaml` — Assistant Defaults

```yaml
assistants:
  claude:
    model: sonnet  # or 'opus', 'haiku', 'claude-*', 'inherit'
    settingSources:  # Which CLAUDE.md, skills, commands, agents the SDK loads
      - project      # <cwd>/.claude/ (default)
      - user         # ~/.claude/ (default; omit both to restrict to project-only)
    claudeBinaryPath: /absolute/path/to/claude  # Optional. Required in compiled binaries
                                                # if CLAUDE_BIN_PATH env var is not set.
  codex:
    model: gpt-5.3-codex
    modelReasoningEffort: medium  # minimal | low | medium | high | xhigh
    webSearchMode: live           # disabled | cached | live
    additionalDirectories:
      - /absolute/path/to/other/repo
    codexBinaryPath: /usr/local/bin/codex  # Optional

# docs:
#   path: docs  # Optional: default is docs/
```

**Configuration priority:** workflow-level options > config file defaults > SDK defaults.

**Model validation:**
- Provider identity is validated at workflow load: `provider:` must be a registered id (`claude`, `codex`, `pi`) or YAML is rejected.
- Model strings are NOT validated — forwarded verbatim to the SDK. Vendor SDKs ship new model names faster than Archon can track.
- Provider resolution: `node.provider ?? workflow.provider ?? config.assistant`. Model never influences provider selection.

## Archon Directory Layouts

**User-level (`~/.archon/`):**
```text
~/.archon/
├── workspaces/owner/repo/
│   ├── source/                  # Cloned repo or symlink → local path
│   ├── worktrees/               # Git worktrees for this project
│   ├── artifacts/
│   │   ├── runs/{id}/           # Per-run artifacts ($ARTIFACTS_DIR)
│   │   └── uploads/{convId}/    # Web UI file uploads (ephemeral)
│   └── logs/                    # Workflow execution logs
├── workflows/                   # Home-scoped workflows (global)
├── commands/                    # Home-scoped commands (global)
├── scripts/                     # Home-scoped scripts (global)
├── vendor/codex/                # Codex native binary (binary builds, user-placed)
├── web-dist/<version>/          # Cached web UI dist (archon serve, binary only)
├── update-check.json            # Update check cache (24h TTL, binary only)
├── archon.db                    # SQLite database (when DATABASE_URL not set)
└── config.yaml                  # Global configuration (non-secrets)
```

**Repo-level (`.archon/` in any repository):**
```text
.archon/
├── commands/       # Custom commands
├── workflows/      # Workflow definitions (YAML)
├── scripts/        # Named scripts for script: nodes (.ts/.js for bun, .py for uv)
├── state/          # Cross-run workflow state (gitignored — never in git)
└── config.yaml     # Repo-specific configuration
```

- `ARCHON_HOME` overrides the base directory (default `~/.archon`)
- Docker: paths automatically set to `/.archon/`

## Home-Scoped vs Project-Scoped Workflows/Commands/Scripts

- Load priority: bundled < global (`~/.archon/`) < project (`.archon/`). Project overrides global by filename or script name.
- Source label: `source: 'global'` on workflows and commands. Scripts don't have a source label.
- Subfolders supported one level deep (e.g. `~/.archon/workflows/triage/foo.yaml`). Deeper nesting is silently ignored.
- Discovery is automatic — `discoverWorkflowsWithConfig(cwd, loadConfig)` and `discoverScriptsForCwd(cwd)` read home-scoped paths unconditionally.
- **Pre-0.x migration**: if Archon detects files at `~/.archon/.archon/workflows/` it emits a one-time WARN with the `mv` command and does NOT load from there. Move with: `mv ~/.archon/.archon/workflows ~/.archon/workflows && rmdir ~/.archon/.archon`

## Bundled Defaults

- Source files: `.archon/commands/defaults/` and `.archon/workflows/defaults/`
- Binary builds: embedded at compile time via `packages/workflows/src/defaults/bundled-defaults.generated.ts`
- Source builds: loaded from filesystem at runtime
- Repo files override defaults by name
- Opt out: `defaults.loadDefaultCommands: false` or `defaults.loadDefaultWorkflows: false` in `.archon/config.yaml`
- **After adding/removing/editing a default**, run `bun run generate:bundled`. `bun run validate` and CI both run `check:bundled` and `check:bundled-skill` and fail loudly if the generated file is stale.

## Adapter Authorization Pattern

- Auth checks happen INSIDE adapters (encapsulation, consistency).
- Auth utilities co-located with each adapter (e.g., `packages/adapters/src/chat/slack/auth.ts`).
- Parse whitelist from env var in constructor (e.g., `TELEGRAM_ALLOWED_USER_IDS`).
- Check in the message handler before invoking the `onMessage` callback.
- Silent rejection for unauthorized users — no error response. Log with masked user IDs.

## Webhooks

- `POST /webhooks/github` — signature verification required (HMAC SHA-256, `X-Hub-Signature-256`).
- Use `c.req.text()` for raw body (needed for signature verification).
- Return 200 immediately, process async.
- @mention detection: parse `@archon` in issue/PR **comments only** (not descriptions). Event: `issue_comment` only. Descriptions often contain example commands or documentation — these are NOT command invocations (see #96).

For the GitHub adapter's full event list and the secrets/env vars it consumes, see `packages/docs-web/src/content/docs/adapters/github.md` and the security reference in `packages/docs-web/src/content/docs/reference/security.md`.

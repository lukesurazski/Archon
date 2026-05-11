# Database Schema

> **Purpose**: Table inventory and session-transition semantics for Archon's database (PostgreSQL or SQLite via `IDatabase` adapters).
> **When to use**: Writing queries, designing migrations, or understanding session lifecycle.
> **Size**: ~40 lines — small, can be read directly.

All tables are prefixed `remote_agent_`.

| Table | Purpose |
|---|---|
| `codebases` | Repository metadata; `commands` JSONB stores filesystem paths to command files |
| `conversations` | Platform conversations (titles, soft-delete); nullable `task_id` links to a task container |
| `sessions` | AI SDK sessions with resume capability; one active session per conversation |
| `isolation_environments` | Git worktree isolation tracking |
| `workflow_runs` | Workflow execution tracking and state |
| `workflow_events` | Step-level workflow event log (transitions, artifacts, errors) |
| `messages` | Conversation message history; tool call metadata in JSONB |
| `codebase_env_vars` | Per-project env vars injected into Claude/Codex/bash/script nodes (managed via Web UI or `env:` in config) |
| `tasks` | Task containers grouping conversations, workflow runs, branch name, PR link (soft-archive via `status='archived'`) |

## Conversation IDs

Format is platform-specific:
- Slack: `thread_ts`
- Telegram: `chat_id`
- GitHub: `owner/repo#number`
- Discord: channel ID
- Web: user-provided string

## Session Transitions

Sessions are **immutable** — transitions create new linked sessions.

- Each transition has an explicit `TransitionTrigger` reason: `first-message`, `plan-to-execute`, `reset-requested`, etc.
- Audit trail: `parent_session_id` links to previous session; `transition_reason` records why.
- Only `plan-to-execute` creates a new session immediately. Other triggers deactivate the current session; the next message creates a fresh one.

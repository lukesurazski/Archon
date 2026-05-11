# CLI Reference

> **Purpose**: Catalog of `bun run cli` (and compiled `archon`) commands.
> **When to use**: Looking up command flags, scripting against the CLI, or routing workflow operations from chat.
> **Size**: ~80 lines — small, can be read directly.

Most commands require running from within a git repository (subdirectories work — resolves to repo root).

## Workflows

```bash
bun run cli workflow list                          # List available workflows
bun run cli workflow list --json                   # Machine-readable output
bun run cli workflow run <name> "<args>"           # Run a workflow
bun run cli workflow run <name> --cwd /path "..."  # Run in specific directory
bun run cli workflow run <name> "..."              # Default: auto-creates worktree
bun run cli workflow run <name> --branch foo "..." # Explicit worktree branch name
bun run cli workflow run <name> --no-worktree "..."# Opt out of isolation
bun run cli workflow status                        # Show running workflows
bun run cli workflow resume <run-id>               # Re-run failed workflow, skip completed nodes
bun run cli workflow abandon <run-id>              # Discard non-terminal run
bun run cli workflow cleanup [days]                # Delete old run records (default: 7 days)
bun run cli workflow event emit --run-id <uuid> --type <type> [--data <json>]
```

## Isolation / Worktrees

```bash
bun run cli isolation list                                 # List active worktrees
bun run cli isolation cleanup [days]                       # Clean up stale environments (default: 7 days)
bun run cli isolation cleanup --merged                     # Clean envs whose branches merged to main
bun run cli isolation cleanup --merged --include-closed    # Also remove closed-PR environments
bun run cli complete <branch-name>                         # Remove worktree + local/remote branches
bun run cli complete <branch-name> --force                 # Skip uncommitted-changes check
```

## Validation

```bash
bun run cli validate workflows               # Validate all workflows
bun run cli validate workflows <name>        # Validate one
bun run cli validate workflows <name> --json # Machine-readable output
bun run cli validate commands                # Validate all command files
bun run cli validate commands <name>         # Validate one
```

## Other

```bash
bun run cli serve                            # Start web UI server (binary builds only)
bun run cli serve --port 4000
bun run cli serve --download-only            # Download web UI without starting
bun run cli skill install [path]             # Install the bundled Archon skill into a project
bun run cli doctor                           # Verify setup (Claude binary, gh auth, DB, adapters)
bun run cli version
```

## Verbosity

- `archon --quiet` — errors only; suppresses Pino logs and workflow progress output
- `archon --verbose` — debug Pino logs and tool-level workflow progress events
- Server: `LOG_LEVEL=debug bun run start`

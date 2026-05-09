# Agent Instructions

## GitHub Remote Policy

- For this checkout, `origin` is the personal fork: `lukesurazski/Archon`.
- For this checkout, `upstream` is the canonical repo: `coleam00/archon`.
- Treat `upstream` as read-only by default.
- Do not open pull requests, push branches, or perform other GitHub write actions against `upstream` unless the user explicitly says to target upstream.
- Default all GitHub write actions to the fork on `origin`.
- Before any PR creation step, state the exact target in one line and wait for confirmation:
  `Creating PR: <owner>/<repo> <- <head-branch> into <base-branch>`

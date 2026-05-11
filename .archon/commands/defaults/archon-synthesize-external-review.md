---
description: Convert external PR review feedback (CodeRabbit, human reviewers, Claude Code review) into the consolidated-review.md format archon-implement-review-fixes expects. Treats every actionable item as HIGH severity.
argument-hint: (none - reads JSON from $ARTIFACTS_DIR/review/)
---

# Synthesize External Review

---

## IMPORTANT: Output Behavior

This command runs as a workflow node, not as a chat response. Keep working output minimal:
- Do NOT narrate each step
- Do NOT print the full JSON you read
- Use TodoWrite silently if you need to track progress
- The only required side effect is writing `$ARTIFACTS_DIR/review/consolidated-review.md`

---

## IMPORTANT: Scratch File Safety

This workflow enforces a path-safety guard. Any tool call that targets a file outside the workflow working path or `$ARTIFACTS_DIR` will fail the node.

- Do NOT create, read, or execute helper files in `/tmp`, `/var/tmp`, another checkout, or any path outside the workflow working path and `$ARTIFACTS_DIR`.
- If you need a helper script, write it under `$WORKFLOW_TMPDIR/` and run it from that path.
- Prefer direct shell pipelines or inline heredocs when possible.
- Never use paths like `/tmp/build_review.py`.

Safe helper-script pattern:

```bash
mkdir -p "$ARTIFACTS_DIR/review"
mkdir -p "$WORKFLOW_TMPDIR"
cat > "$WORKFLOW_TMPDIR/build-review.py" <<'PY'
# helper code here
PY
python3 "$WORKFLOW_TMPDIR/build-review.py"
```

---

## Your Mission

Read the external review feedback collected by the previous workflow node, filter out everything that isn't actionable, and write a consolidated review artifact in the format that `archon-implement-review-fixes` expects.

**Severity policy (per workflow config)**: every actionable item is tagged **HIGH**. External reviewers don't ship severity labels and we'd rather over-fix than skip something that mattered. Do not invent CRITICAL/MEDIUM/LOW buckets.

---

## Phase 1: LOAD

Read these artifacts produced by the `fetch-feedback` node:

```bash
PR_NUMBER=$(cat $ARTIFACTS_DIR/.pr-number)
cat $ARTIFACTS_DIR/review/pr-meta.json
cat $ARTIFACTS_DIR/review/inline-comments.json
cat $ARTIFACTS_DIR/review/reviews.json
cat $ARTIFACTS_DIR/review/review-threads.json
```

What each contains:
- **`pr-meta.json`** - `gh pr view` summary: PR author, head ref, top-level comments, reviews summary.
- **`inline-comments.json`** - every per-line review comment ever posted to the PR (`pulls/{n}/comments`). Includes `path`, `line`, `body`, `user.login`, `pull_request_review_id`, `in_reply_to_id`, `position` (null if outdated), `id`.
- **`reviews.json`** - review submissions (`pulls/{n}/reviews`). Each has `state` (`COMMENTED` / `APPROVED` / `CHANGES_REQUESTED` / `DISMISSED`), `body`, `user.login`, `submitted_at`, `id`.
- **`review-threads.json`** - GraphQL response listing each review thread with `isResolved`, `isOutdated`, and the `databaseId` of each comment in the thread. Use this to map inline comments to their thread state.

---

## Phase 2: FILTER

Discard items that aren't actionable. **For each filter, the rule is followed by why it exists** - if you find an edge case, prefer the spirit of the rule.

### 2.1 Drop entire reviews where `state in {APPROVED, DISMISSED}`
The reviewer is not asking for changes.

### 2.2 Drop reviews and inline comments authored by Archon itself
Inspect `user.login`. Normalize both values before compare (trim, lowercase, strip leading `@` from the configured mention). Skip anything whose normalized login matches the normalized configured bot mention (default `archon`) OR whose comment body contains the bot-response marker `<!-- archon-bot-response -->`. Reason: prevents loops where Archon reacts to its own status comments (and avoids missing matches when config uses `@archon` while GitHub login is `archon`).

### 2.3 Drop inline comments inside resolved or outdated threads
Build a set of resolved/outdated comment `databaseId`s from `review-threads.json` (any thread where `isResolved == true` OR `isOutdated == true` - collect every `comments.nodes[].databaseId`). Then drop any inline comment whose `id` is in that set. Reason: humans already marked these handled or the diff moved past them.

### 2.4 Drop inline comments with `position == null`
GitHub sets `position` to null when the comment refers to a line that no longer exists in the diff. Reason: same as outdated - fixing it is undefined.

### 2.5 Drop reply comments whose parent has been satisfied
If `in_reply_to_id` points to a comment authored by Archon, and the reply is short and conversational (e.g. "thanks", "lgtm", "got it"), skip it. Light heuristic - when in doubt, keep it.

### 2.6 Drop empty review bodies whose only content is inline comments
If a review's `body` is empty/whitespace, do not emit a HIGH issue for it - the inline comments under it carry the actionable content and will be emitted on their own. Reason: avoid double-counting a single review.

---

## Phase 3: GROUP

After filtering, group remaining items into a flat list of HIGH issues:

1. Each surviving inline comment becomes one HIGH issue. Title = first sentence of the comment body (truncate to ~80 chars). Location = `path:line` (use `original_line` if `line` is null). Source = `user.login`.
2. Each surviving review with a non-empty body becomes one HIGH issue. Title = first sentence of `body`. Location = `(review-level)`. Source = `user.login` (note: `state=CHANGES_REQUESTED` reviewers are stronger signal than `COMMENTED`; record the state in the issue).
3. Top-level PR comments from `pr-meta.json.comments` - include only if they look like review feedback (heuristic: contain words like "fix", "should", "need to", "remove", "change", or are from CodeRabbit/Claude). Skip pure status chatter.
4. Deduplicate: if two reviewers raise the same issue at the same `path:line`, merge into one HIGH issue listing both sources.

If after grouping there are **zero issues**, write an empty consolidated file (truncate to size 0) and exit. The workflow's `check-actionable` node will detect the empty file and skip the implement step.

```bash
# Example: truncate, do not `touch` — `touch` leaves prior content intact.
: > "$ARTIFACTS_DIR/review/consolidated-review.md"
```

---

## Phase 4: GENERATE

Write `$ARTIFACTS_DIR/review/consolidated-review.md` in this exact structure (matches what `archon-implement-review-fixes` reads). The `## HIGH Issues` heading is required - `check-actionable` greps for it.

```markdown
# Consolidated Review: PR #{number} (External Feedback)

**Date**: {ISO timestamp}
**Sources**: {comma-separated list of unique reviewer logins}
**Total HIGH issues**: {count}

> Severity policy: all external review items are tagged HIGH for the
> archon-respond-to-pr-feedback workflow.

---

## Executive Summary

{2-3 sentence summary of what reviewers are asking for, in plain language. Mention reviewer types - e.g. "CodeRabbit raised 4 inline issues; one human reviewer requested changes on error handling."}

**Auto-fix Candidates**: {n} HIGH issues will be auto-fixed.

---

## CRITICAL Issues (Must Fix)

(none - see severity policy above)

---

## HIGH Issues (Should Fix)

### Issue 1: {short title from first sentence}

**Source**: {reviewer login}{ - review state if applicable, e.g. " (CHANGES_REQUESTED review)"}
**Location**: `{path}:{line}` or `(review-level)` or `(top-level PR comment)`
**Comment ID**: {github comment/review id, for traceability}

**Reviewer said**:
> {full quoted body of the comment, preserving any code blocks the reviewer included}

**Action**:
{Your interpretation of what change is needed. If the reviewer included a suggested fix or `suggestion` block, lift it verbatim and reference it here. If the ask is ambiguous, write "Ambiguous - implement-review-fixes should mark this as unfixable and report back."}

---

### Issue 2: {title}

{Same structure...}

---

## MEDIUM Issues (Options for User)

(none - see severity policy above)

---

## LOW Issues (For Consideration)

(none - see severity policy above)

---

## Sources Summary

| Reviewer | Type | HIGH issues raised |
|----------|------|-------------------|
| coderabbitai | bot | {n} |
| {human-login} | human ({CHANGES_REQUESTED|COMMENTED}) | {n} |
| {...} | ... | ... |

---

## Metadata

- **Synthesized**: {ISO timestamp}
- **PR head SHA at synthesis**: {from pr-meta.json headRefOid}
- **Artifact**: `$ARTIFACTS_DIR/review/consolidated-review.md`
- **Filter stats**:
  - Inline comments seen: {n}
  - Inline comments after filter: {n}
  - Reviews seen: {n}
  - Reviews after filter: {n}
  - Resolved/outdated threads dropped: {n}
  - Bot-authored items dropped: {n}
```

---

## Phase 5: VERIFY

```bash
test -f "$ARTIFACTS_DIR/review/consolidated-review.md" && echo "written"
```

If the file is non-empty, confirm it contains the literal string `## HIGH Issues` (the downstream `check-actionable` node greps for it).

---

## Success Criteria

- **EXTERNAL_FEEDBACK_LOADED**: All four JSON files read successfully
- **NON_ACTIONABLE_FILTERED**: Approved/dismissed reviews, bot's own comments, resolved/outdated threads excluded
- **CONSOLIDATED_WRITTEN**: `consolidated-review.md` exists, with `## HIGH Issues` section if any items survive filtering, or empty if all filtered out
- **NO_SEVERITY_INVENTED**: Every emitted issue is HIGH, never CRITICAL/MEDIUM/LOW

-- Introduce tasks as a first-class organizational container for web conversations.
--
-- BACKFILL: The DO $$ block below creates one task per pre-existing visible
-- conversation. This migration must run exactly once (via the migration
-- tracker). It is intentionally NOT included in `migrations/000_combined.sql`
-- (the fresh-install schema) because new databases have no rows to backfill.
-- The SQLite equivalent in `packages/core/src/db/adapters/sqlite.ts` gates the
-- same backfill on `PRAGMA user_version` for identical idempotency.

CREATE TABLE IF NOT EXISTS remote_agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  branch_name VARCHAR(500),
  pr_url VARCHAR(1000),
  pr_number INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES remote_agent_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_codebase
  ON remote_agent_tasks(codebase_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON remote_agent_tasks(status);

CREATE INDEX IF NOT EXISTS idx_conversations_task_id
  ON remote_agent_conversations(task_id);

-- Compound indexes on workflow_runs to support the latest-run-per-task
-- subqueries in `taskSummarySelect()`: filter by (parent_)conversation_id,
-- then ORDER BY started_at DESC LIMIT 1. Without these, the planner falls
-- back to seq scan + sort for every task on every listTasks call.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_conv_started_at
  ON remote_agent_workflow_runs(conversation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_conv_started_at
  ON remote_agent_workflow_runs(parent_conversation_id, started_at DESC);

-- Backfill one task per visible conversation so no existing chat is orphaned.
DO $$
DECLARE
  conv RECORD;
  new_task_id UUID;
BEGIN
  FOR conv IN
    SELECT id, title, platform_conversation_id, codebase_id, created_at, updated_at, last_activity_at
    FROM remote_agent_conversations
    WHERE deleted_at IS NULL AND task_id IS NULL
  LOOP
    INSERT INTO remote_agent_tasks (title, codebase_id, created_at, updated_at)
    VALUES (
      COALESCE(conv.title, 'Task - ' || LEFT(conv.platform_conversation_id, 12)),
      conv.codebase_id,
      COALESCE(conv.created_at, NOW()),
      COALESCE(conv.updated_at, conv.last_activity_at, NOW())
    )
    RETURNING id INTO new_task_id;

    UPDATE remote_agent_conversations
    SET task_id = new_task_id
    WHERE id = conv.id;
  END LOOP;
END $$;

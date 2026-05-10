-- Introduce tasks as a first-class organizational container for web conversations.

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

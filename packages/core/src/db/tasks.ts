/**
 * Database operations for task containers.
 */
import { pool, getDialect } from './connection';
import { normalizeWorkflowRun } from './workflows';
import type { Conversation, Task } from '../types';
import type { WorkflowRun, WorkflowRunStatus } from '@archon/workflows/schemas/workflow-run';

export interface TaskSummary extends Task {
  conversation_count: number;
  latest_run_status: WorkflowRunStatus | null;
  latest_run_started_at: Date | null;
  last_activity_at: Date | null;
}

export interface TaskDetail extends TaskSummary {
  conversations: Conversation[];
  workflow_runs: WorkflowRun[];
}

export interface ListTasksOptions {
  codebaseId?: string;
  status?: 'active' | 'archived';
  limit?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  codebaseId?: string | null;
  branchName?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  branchName?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  status?: 'active' | 'archived';
}

/**
 * Coerce SQLite ISO-string timestamps to `Date` so callers can rely on the
 * declared `Date` typing regardless of backend (node-postgres already returns
 * `Date` for TIMESTAMPTZ). Mirrors `normalizeWorkflowRun` in `workflows.ts`.
 */
function normalizeTaskSummary<T extends TaskSummary>(row: T): T {
  row.conversation_count = row.conversation_count ?? 0;
  if (typeof row.created_at === 'string') row.created_at = new Date(row.created_at);
  if (typeof row.updated_at === 'string') row.updated_at = new Date(row.updated_at);
  if (typeof row.latest_run_started_at === 'string') {
    row.latest_run_started_at = new Date(row.latest_run_started_at);
  }
  if (typeof row.last_activity_at === 'string') {
    row.last_activity_at = new Date(row.last_activity_at);
  }
  return row;
}

/**
 * Builds the summary SELECT used by listTasks/getTask/getTaskDetail. Joins
 * workflow runs via `COALESCE(parent_conversation_id, conversation_id)` so
 * background-worker runs (which inherit the parent's task_id — see
 * orchestrator.ts `dispatchBackgroundWorkflow`) roll up under the same task
 * as their parent conversation.
 */
function taskSummarySelect(): string {
  return `SELECT t.*,
    (SELECT CAST(COUNT(*) AS INTEGER) FROM remote_agent_conversations c
      WHERE c.task_id = t.id AND c.deleted_at IS NULL) AS conversation_count,
    (SELECT r.status FROM remote_agent_workflow_runs r
      JOIN remote_agent_conversations c ON c.id = COALESCE(r.parent_conversation_id, r.conversation_id)
      WHERE c.task_id = t.id AND c.deleted_at IS NULL
      ORDER BY r.started_at DESC LIMIT 1) AS latest_run_status,
    (SELECT r.started_at FROM remote_agent_workflow_runs r
      JOIN remote_agent_conversations c ON c.id = COALESCE(r.parent_conversation_id, r.conversation_id)
      WHERE c.task_id = t.id AND c.deleted_at IS NULL
      ORDER BY r.started_at DESC LIMIT 1) AS latest_run_started_at,
    (SELECT MAX(c.last_activity_at) FROM remote_agent_conversations c
      WHERE c.task_id = t.id AND c.deleted_at IS NULL) AS last_activity_at
    FROM remote_agent_tasks t`;
}

export async function listTasks(options?: ListTasksOptions): Promise<TaskSummary[]> {
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (options?.codebaseId) {
    values.push(options.codebaseId);
    clauses.push(`t.codebase_id = $${String(values.length)}`);
  }

  values.push(options?.status ?? 'active');
  clauses.push(`t.status = $${String(values.length)}`);

  values.push(options?.limit ?? 100);
  const limitParam = `$${String(values.length)}`;
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await pool.query<TaskSummary>(
    `${taskSummarySelect()}
     ${where}
     ORDER BY COALESCE(
       (SELECT MAX(c.last_activity_at) FROM remote_agent_conversations c
        WHERE c.task_id = t.id AND c.deleted_at IS NULL),
       t.updated_at
     ) DESC
     LIMIT ${limitParam}`,
    values
  );

  return result.rows.map(normalizeTaskSummary);
}

export async function getTask(id: string): Promise<TaskSummary | null> {
  const result = await pool.query<TaskSummary>(`${taskSummarySelect()} WHERE t.id = $1`, [id]);
  const row = result.rows[0];
  return row ? normalizeTaskSummary(row) : null;
}

export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  const task = await getTask(id);
  if (!task) return null;

  const [conversationsResult, runsResult] = await Promise.all([
    pool.query<Conversation>(
      `SELECT * FROM remote_agent_conversations
       WHERE task_id = $1 AND deleted_at IS NULL
       ORDER BY last_activity_at DESC NULLS LAST`,
      [id]
    ),
    pool.query<WorkflowRun>(
      `SELECT DISTINCT r.* FROM remote_agent_workflow_runs r
       JOIN remote_agent_conversations c
         ON c.id = r.conversation_id OR c.id = r.parent_conversation_id
       WHERE c.task_id = $1 AND c.deleted_at IS NULL
       ORDER BY r.started_at DESC
       LIMIT 50`,
      [id]
    ),
  ]);

  return {
    ...task,
    conversations: [...conversationsResult.rows],
    workflow_runs: runsResult.rows.map(normalizeWorkflowRun),
  };
}

export async function createTask(input: CreateTaskInput): Promise<TaskSummary> {
  const result = await pool.query<Task>(
    `INSERT INTO remote_agent_tasks
       (title, description, codebase_id, branch_name, pr_url, pr_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.title,
      input.description ?? null,
      input.codebaseId ?? null,
      input.branchName ?? null,
      input.prUrl ?? null,
      input.prNumber ?? null,
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create task');
  const task = await getTask(row.id);
  if (!task) throw new Error('Failed to read created task');
  return task;
}

export async function updateTask(
  id: string,
  updates: UpdateTaskInput
): Promise<TaskSummary | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  function add(field: string, value: unknown): void {
    values.push(value);
    fields.push(`${field} = $${String(values.length)}`);
  }

  if (updates.title !== undefined) add('title', updates.title);
  if (updates.description !== undefined) add('description', updates.description);
  if (updates.branchName !== undefined) add('branch_name', updates.branchName);
  if (updates.prUrl !== undefined) add('pr_url', updates.prUrl);
  if (updates.prNumber !== undefined) add('pr_number', updates.prNumber);
  if (updates.status !== undefined) add('status', updates.status);

  if (fields.length === 0) return getTask(id);

  const dialect = getDialect();
  fields.push(`updated_at = ${dialect.now()}`);
  values.push(id);

  const result = await pool.query(
    `UPDATE remote_agent_tasks SET ${fields.join(', ')} WHERE id = $${String(values.length)}`,
    values
  );
  if (result.rowCount === 0) return null;
  return getTask(id);
}

export async function archiveTask(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE remote_agent_tasks SET status = 'archived', updated_at = ${getDialect().now()}
     WHERE id = $1`,
    [id]
  );
  return result.rowCount > 0;
}

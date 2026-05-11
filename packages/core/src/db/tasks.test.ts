import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));

mock.module('./connection', () => ({
  pool: { query: mockQuery },
  getDialect: () => mockPostgresDialect,
  getDatabaseType: () => 'postgresql' as const,
}));

import {
  listTasks,
  getTask,
  getTaskDetail,
  createTask,
  updateTask,
  archiveTask,
  type TaskSummary,
} from './tasks';

describe('tasks db', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(() => Promise.resolve(createQueryResult([])));
  });

  const mockTaskRow: TaskSummary = {
    id: 'task-1',
    title: 'Implement auth',
    description: null,
    codebase_id: 'cb-1',
    branch_name: null,
    pr_url: null,
    pr_number: null,
    status: 'active',
    created_at: new Date('2026-05-10T00:00:00Z'),
    updated_at: new Date('2026-05-10T00:00:00Z'),
    conversation_count: 0,
    latest_run_status: null,
    latest_run_started_at: null,
    last_activity_at: null,
  };

  describe('listTasks', () => {
    test('defaults to active status and limit 100', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockTaskRow]));
      await listTasks();
      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // values are [status, limit] when no codebaseId is provided
      expect(params).toEqual(['active', 100]);
    });

    test('filters by codebaseId when provided', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      await listTasks({ codebaseId: 'cb-1' });
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('t.codebase_id = $1');
      expect(params).toEqual(['cb-1', 'active', 100]);
    });

    test('respects explicit limit and status', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      await listTasks({ status: 'archived', limit: 25 });
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('t.status = $1');
      expect(params).toEqual(['archived', 25]);
    });

    test('normalizes missing conversation_count to 0', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockTaskRow, conversation_count: null } as unknown as TaskSummary])
      );
      const result = await listTasks();
      expect(result[0]?.conversation_count).toBe(0);
    });
  });

  describe('getTask', () => {
    test('returns task when row exists', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockTaskRow]));
      const result = await getTask('task-1');
      expect(result).toEqual(mockTaskRow);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE t.id = $1');
      expect(params).toEqual(['task-1']);
    });

    test('returns null when row missing', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      const result = await getTask('missing');
      expect(result).toBeNull();
    });
  });

  describe('getTaskDetail', () => {
    test('returns null when task does not exist', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      const result = await getTaskDetail('missing');
      expect(result).toBeNull();
      // Only the getTask query should have run.
      expect(mockQuery.mock.calls.length).toBe(1);
    });

    test('includes conversations and workflow_runs when task exists', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([mockTaskRow])) // getTask
        .mockResolvedValueOnce(createQueryResult([{ id: 'conv-1' } as never])) // conversations
        .mockResolvedValueOnce(createQueryResult([{ id: 'run-1', metadata: {} } as never])); // runs
      const result = await getTaskDetail('task-1');
      expect(result).not.toBeNull();
      expect(result?.conversations).toHaveLength(1);
      expect(result?.workflow_runs).toHaveLength(1);
    });

    test('conversations query excludes soft-deleted rows', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([mockTaskRow]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]));
      await getTaskDetail('task-1');
      const [convSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      // Guards against a refactor that drops the deleted_at filter and starts
      // leaking soft-deleted conversations into the task workspace UI.
      expect(convSql).toContain('deleted_at IS NULL');
    });

    test('workflow_runs query aggregates both direct and parent_conversation rows', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([mockTaskRow]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]));
      await getTaskDetail('task-1');
      const [runsSql] = mockQuery.mock.calls[2] as [string, unknown[]];
      // The OR clause is load-bearing: background workers (spawned via
      // dispatchBackgroundWorkflow) inherit the parent's task_id, so their
      // workflow_runs reach the task via parent_conversation_id rather than
      // direct conversation_id.
      expect(runsSql).toContain('c.id = r.conversation_id OR c.id = r.parent_conversation_id');
    });

    test('applies normalizeWorkflowRun to parse stringified metadata', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([mockTaskRow]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(
          createQueryResult([{ id: 'run-1', metadata: '{"k":"v"}' } as never])
        );
      const result = await getTaskDetail('task-1');
      expect(result?.workflow_runs[0]?.metadata).toEqual({ k: 'v' });
    });
  });

  describe('normalizeTaskSummary (timestamp coercion)', () => {
    test('coerces SQLite string created_at/updated_at to Date', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockTaskRow,
            created_at: '2026-05-10T00:00:00Z' as unknown as Date,
            updated_at: '2026-05-10T00:00:00Z' as unknown as Date,
          },
        ])
      );
      const result = await getTask('task-1');
      expect(result?.created_at).toBeInstanceOf(Date);
      expect(result?.updated_at).toBeInstanceOf(Date);
    });

    test('passes Date created_at/updated_at through unchanged (PG path)', async () => {
      const pgDate = new Date('2026-05-10T00:00:00Z');
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockTaskRow, created_at: pgDate, updated_at: pgDate }])
      );
      const result = await getTask('task-1');
      expect(result?.created_at).toBe(pgDate);
      expect(result?.updated_at).toBe(pgDate);
    });

    test('coerces nullable Date columns when SQLite returns strings', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockTaskRow,
            latest_run_started_at: '2026-05-10T01:00:00Z' as unknown as Date,
            last_activity_at: '2026-05-10T02:00:00Z' as unknown as Date,
          },
        ])
      );
      const result = await getTask('task-1');
      expect(result?.latest_run_started_at).toBeInstanceOf(Date);
      expect(result?.last_activity_at).toBeInstanceOf(Date);
    });
  });

  describe('createTask', () => {
    test('inserts row and reads it back', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ id: 'task-1' } as never])) // INSERT
        .mockResolvedValueOnce(createQueryResult([mockTaskRow])); // getTask read-back
      const result = await createTask({ title: 'Implement auth' });
      expect(result).toEqual(mockTaskRow);
      const [insertSql, insertParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(insertSql).toContain('INSERT INTO remote_agent_tasks');
      // title + 5 nullable fields = 6 params
      expect(insertParams).toEqual(['Implement auth', null, null, null, null, null]);
    });

    test('throws when INSERT returns no row', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      await expect(createTask({ title: 'x' })).rejects.toThrow('Failed to create task');
    });

    test('throws when follow-up getTask returns null', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ id: 'task-1' } as never])) // INSERT
        .mockResolvedValueOnce(createQueryResult([])); // getTask returns nothing
      await expect(createTask({ title: 'x' })).rejects.toThrow('Failed to read created task');
    });
  });

  describe('updateTask', () => {
    test('returns getTask result when no fields provided (no-op)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockTaskRow])); // getTask
      const result = await updateTask('task-1', {});
      expect(result).toEqual(mockTaskRow);
      // Only the getTask read should run — no UPDATE.
      expect(mockQuery.mock.calls.length).toBe(1);
    });

    test('returns null when UPDATE matches no rows', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0)); // UPDATE
      const result = await updateTask('nonexistent', { title: 'x' });
      expect(result).toBeNull();
    });

    test('builds dynamic UPDATE with sequential placeholders', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([], 1)) // UPDATE
        .mockResolvedValueOnce(createQueryResult([mockTaskRow])); // getTask read-back
      await updateTask('task-1', { title: 'New title', status: 'archived' });
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('status = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $3');
      expect(params).toEqual(['New title', 'archived', 'task-1']);
    });
  });

  describe('archiveTask', () => {
    test('returns true when row updated', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      expect(await archiveTask('task-1')).toBe(true);
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("status = 'archived'");
    });

    test('returns false when row missing', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));
      expect(await archiveTask('missing')).toBe(false);
    });
  });
});

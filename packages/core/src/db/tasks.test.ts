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
    created_at: '2026-05-10T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
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

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ConversationLockManager } from '@archon/core';
import type { WebAdapter } from '../adapters/web';
import { validationErrorHook } from './openapi-defaults';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';

// ---------------------------------------------------------------------------
// Mock setup — must be declared before any dynamic imports of mocked modules
// ---------------------------------------------------------------------------

const mockListTasks = mock(async (_options?: unknown) => [] as unknown[]);
const mockGetTask = mock(async (_id: string) => null as unknown);
const mockGetTaskDetail = mock(async (_id: string) => null as unknown);
const mockCreateTask = mock(async (_input: unknown) => ({ id: 'task-new' }) as unknown);
const mockUpdateTask = mock(async (_id: string, _patch: unknown) => null as unknown);
const mockArchiveTask = mock(async (_id: string) => true);

const mockGetCodebase = mock(async (_id: string) => null as unknown);
const mockGetOrCreateConversation = mock(async () => ({
  id: 'internal-uuid-123',
  platform_conversation_id: 'web-test-abc',
  title: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  platform_type: 'web',
  deleted_at: null,
  codebase_id: null,
}));

mock.module('@archon/core', () => ({
  handleMessage: mock(async () => {}),
  getDatabaseType: () => 'sqlite',
  loadConfig: mock(async () => ({})),
  cloneRepository: mock(async () => ({ codebaseId: 'x', alreadyExisted: false })),
  registerRepository: mock(async () => ({ codebaseId: 'x', alreadyExisted: false })),
  ConversationNotFoundError: class ConversationNotFoundError extends Error {
    constructor(id: string) {
      super(`Conversation not found: ${id}`);
      this.name = 'ConversationNotFoundError';
    }
  },
  getArchonWorkspacesPath: () => '/tmp/.archon/workspaces',
  generateAndSetTitle: mock(async () => {}),
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
}));

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
  getWorkflowFolderSearchPaths: mock(() => ['.archon/workflows']),
  getCommandFolderSearchPaths: mock(() => ['.archon/commands']),
  getDefaultCommandsPath: mock(() => '/tmp/.archon-test-nonexistent/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/tmp/.archon-test-nonexistent/workflows/defaults'),
  getArchonWorkspacesPath: () => '/tmp/.archon/workspaces',
}));

mockAllWorkflowModules();

mock.module('@archon/git', () => ({
  removeWorktree: mock(async () => {}),
  toRepoPath: (p: string) => p,
  toWorktreePath: (p: string) => p,
}));

mock.module('@archon/core/db/conversations', () => ({
  findConversationByPlatformId: mock(async () => null),
  listConversations: mock(async () => []),
  getOrCreateConversation: mockGetOrCreateConversation,
  softDeleteConversation: mock(async () => {}),
  updateConversationTitle: mock(async () => {}),
  getConversationById: mock(async () => null),
  updateConversation: mock(async () => {}),
}));

mock.module('@archon/core/db/codebases', () => ({
  listCodebases: mock(async () => []),
  getCodebase: mockGetCodebase,
  deleteCodebase: mock(async () => {}),
}));

mock.module('@archon/core/db/tasks', () => ({
  listTasks: mockListTasks,
  getTask: mockGetTask,
  getTaskDetail: mockGetTaskDetail,
  createTask: mockCreateTask,
  updateTask: mockUpdateTask,
  archiveTask: mockArchiveTask,
}));

mock.module('@archon/core/db/isolation-environments', () => ({
  listByCodebase: mock(async () => []),
  updateStatus: mock(async () => {}),
}));

mock.module('@archon/core/db/workflows', () => ({
  listWorkflowRuns: mock(async () => []),
  listDashboardRuns: mock(async () => ({
    runs: [],
    total: 0,
    counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
  })),
  getWorkflowRun: mock(async () => null),
  cancelWorkflowRun: mock(async () => {}),
  getWorkflowRunByWorkerPlatformId: mock(async () => null),
}));

mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(async () => []),
}));

mock.module('@archon/core/db/messages', () => ({
  addMessage: mock(async () => ({
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'user',
    content: 'hello',
    metadata: '{}',
    created_at: new Date().toISOString(),
  })),
  listMessages: mock(async () => []),
}));

mock.module('@archon/core/utils/commands', () => ({
  findMarkdownFilesRecursive: mock(async () => []),
}));

// Import the module under test AFTER all mock.module() calls
import { registerApiRoutes } from './api';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MOCK_TASK = {
  id: 'task-1',
  title: 'Implement auth',
  description: null,
  codebase_id: 'cb-1',
  branch_name: null,
  pr_url: null,
  pr_number: null,
  status: 'active' as const,
  created_at: '2026-05-10T00:00:00Z',
  updated_at: '2026-05-10T00:00:00Z',
  conversation_count: 0,
  latest_run_status: null,
  latest_run_started_at: null,
  last_activity_at: null,
};

const MOCK_CODEBASE = {
  id: 'cb-1',
  name: 'my-project',
  repository_url: null,
  default_cwd: '/workspace',
  ai_assistant_type: 'claude',
  commands: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string) => {}),
    emitSSE: mock(async () => {}),
    emitLockEvent: mock(async () => {}),
  } as unknown as WebAdapter;
  const mockLockManager = {
    acquireLock: mock(async (_id: string, fn: () => Promise<void>) => {
      await fn();
      return { status: 'started' };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: GET /api/tasks
// ---------------------------------------------------------------------------

describe('GET /api/tasks', () => {
  beforeEach(() => {
    mockListTasks.mockReset();
  });

  test('defaults to active status and limit 100', async () => {
    mockListTasks.mockImplementationOnce(async () => []);
    const app = makeApp();
    const res = await app.request('/api/tasks');
    expect(res.status).toBe(200);
    expect(mockListTasks).toHaveBeenCalledWith({
      codebaseId: undefined,
      status: 'active',
      limit: 100,
    });
  });

  test('clamps oversized limit to 500', async () => {
    mockListTasks.mockImplementationOnce(async () => []);
    const app = makeApp();
    await app.request('/api/tasks?limit=99999');
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });

  test('clamps undersized limit to 1', async () => {
    mockListTasks.mockImplementationOnce(async () => []);
    const app = makeApp();
    await app.request('/api/tasks?limit=0');
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });

  test('coerces invalid limit to default 100', async () => {
    mockListTasks.mockImplementationOnce(async () => []);
    const app = makeApp();
    await app.request('/api/tasks?limit=abc');
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  test('passes archived status when valid', async () => {
    mockListTasks.mockImplementationOnce(async () => []);
    const app = makeApp();
    await app.request('/api/tasks?status=archived');
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
  });

  test('rejects unknown status with 400 (no silent coercion to active)', async () => {
    const app = makeApp();
    const res = await app.request('/api/tasks?status=garbage');
    expect(res.status).toBe(400);
    expect(mockListTasks).not.toHaveBeenCalled();
  });

  test('passes codebaseId filter through', async () => {
    mockListTasks.mockImplementationOnce(async () => []);
    const app = makeApp();
    await app.request('/api/tasks?codebaseId=cb-1');
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ codebaseId: 'cb-1' }));
  });

  test('returns 500 when DB throws', async () => {
    mockListTasks.mockImplementationOnce(async () => {
      throw new Error('DB unavailable');
    });
    const app = makeApp();
    const res = await app.request('/api/tasks');
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/tasks
// ---------------------------------------------------------------------------

describe('POST /api/tasks', () => {
  beforeEach(() => {
    mockCreateTask.mockReset();
    mockGetCodebase.mockReset();
  });

  test('creates task with required title only', async () => {
    mockCreateTask.mockImplementationOnce(async () => MOCK_TASK);
    const app = makeApp();
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Implement auth' }),
    });
    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Implement auth' })
    );
  });

  test('returns 400 when codebaseId references missing codebase', async () => {
    mockGetCodebase.mockImplementationOnce(async () => null);
    const app = makeApp();
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', codebaseId: 'missing' }),
    });
    expect(res.status).toBe(400);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  test('creates task when codebaseId references existing codebase', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);
    mockCreateTask.mockImplementationOnce(async () => MOCK_TASK);
    const app = makeApp();
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', codebaseId: 'cb-1' }),
    });
    expect(res.status).toBe(200);
    expect(mockGetCodebase).toHaveBeenCalledWith('cb-1');
    expect(mockCreateTask).toHaveBeenCalled();
  });

  test('rejects empty title via Zod min(1)', async () => {
    const app = makeApp();
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(400);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  test('rejects unknown body fields (strict schema)', async () => {
    const app = makeApp();
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', extra: 'field' }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/tasks/:id
// ---------------------------------------------------------------------------

describe('GET /api/tasks/:id', () => {
  beforeEach(() => {
    mockGetTaskDetail.mockReset();
  });

  test('returns task detail when found', async () => {
    mockGetTaskDetail.mockImplementationOnce(async () => ({
      ...MOCK_TASK,
      conversations: [],
      workflow_runs: [],
    }));
    const app = makeApp();
    const res = await app.request('/api/tasks/task-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('task-1');
  });

  test('returns 404 when not found', async () => {
    mockGetTaskDetail.mockImplementationOnce(async () => null);
    const app = makeApp();
    const res = await app.request('/api/tasks/missing');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: PATCH /api/tasks/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/tasks/:id', () => {
  beforeEach(() => {
    mockUpdateTask.mockReset();
  });

  test('returns updated task on success', async () => {
    mockUpdateTask.mockImplementationOnce(async () => ({ ...MOCK_TASK, status: 'archived' }));
    const app = makeApp();
    const res = await app.request('/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(200);
    expect(mockUpdateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'archived' })
    );
  });

  test('returns 404 when task missing', async () => {
    mockUpdateTask.mockImplementationOnce(async () => null);
    const app = makeApp();
    const res = await app.request('/api/tasks/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  test('rejects unknown body fields (strict schema)', async () => {
    const app = makeApp();
    const res = await app.request('/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unknown: 1 }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/tasks/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/tasks/:id', () => {
  beforeEach(() => {
    mockArchiveTask.mockReset();
  });

  test('returns 200 with success: true on archive', async () => {
    mockArchiveTask.mockImplementationOnce(async () => true);
    const app = makeApp();
    const res = await app.request('/api/tasks/task-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(mockArchiveTask).toHaveBeenCalledWith('task-1');
  });

  test('returns 404 when archiveTask returns false', async () => {
    mockArchiveTask.mockImplementationOnce(async () => false);
    const app = makeApp();
    const res = await app.request('/api/tasks/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

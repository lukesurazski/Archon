import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';
import { MockPlatformAdapter } from '../test/mocks/platform';
import type { Conversation, Codebase } from '../types';
import type { IsolationEnvironmentRow } from '@archon/isolation';

// ─── Mock setup (BEFORE importing module under test) ─────────────────────────

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
  getArchonWorkspacesPath: mock(() => '/home/test/.archon/workspaces'),
  ensureArchonWorkspacesPath: mock(() => Promise.resolve('/home/test/.archon/workspaces')),
  getArchonHome: mock(() => '/home/test/.archon'),
}));

// DB mocks
const mockUpdateConversation = mock(() => Promise.resolve());
const mockGetOrCreateConversation = mock(() => Promise.resolve(null));
const mockGetConversationById = mock(() => Promise.resolve(null));
mock.module('../db/conversations', () => ({
  getConversationById: mockGetConversationById,
  getOrCreateConversation: mockGetOrCreateConversation,
  getConversationByPlatformId: mock(() => Promise.resolve(null)),
  updateConversation: mockUpdateConversation,
  touchConversation: mock(() => Promise.resolve()),
}));

const mockGetCodebase = mock(() => Promise.resolve(null));
mock.module('../db/codebases', () => ({
  getCodebase: mockGetCodebase,
  listCodebases: mock(() => Promise.resolve([])),
  createCodebase: mock(() => Promise.resolve({ id: 'new-codebase-id' })),
}));

mock.module('../db/isolation-environments', () => ({
  createIsolationStore: mock(() => ({
    updateStatus: mock(() => Promise.resolve()),
  })),
}));

mock.module('../db/sessions', () => ({
  getActiveSession: mock(() => Promise.resolve(null)),
  createSession: mock(() => Promise.resolve(null)),
  updateSession: mock(() => Promise.resolve()),
  deactivateSession: mock(() => Promise.resolve()),
  transitionSession: mock(() => Promise.resolve(null)),
}));

mock.module('../handlers/command-handler', () => ({
  handleCommand: mock(() => Promise.resolve({ message: '', modified: false, success: true })),
  parseCommand: mock((msg: string) => ({
    command: msg.split(/\s+/)[0].substring(1),
    args: msg.split(/\s+/).slice(1),
  })),
}));

mock.module('@archon/providers', () => ({
  getAgentProvider: mock(() => null),
}));

const mockCreateWorkflowRun = mock(() => Promise.resolve({ id: 'run-1' }));
mock.module('../workflows/store-adapter', () => ({
  createWorkflowDeps: mock(() => ({
    store: {
      createWorkflowRun: mockCreateWorkflowRun,
    },
    getAgentProvider: () => ({}),
    loadConfig: async () => ({}),
  })),
}));

mock.module('../config/config-loader', () => ({
  loadConfig: mock(() => Promise.resolve({})),
  loadRepoConfig: mock(() => Promise.resolve(null)),
}));

mock.module('../utils/worktree-sync', () => ({
  syncArchonToWorktree: mock(() => Promise.resolve(false)),
}));

mock.module('../services/cleanup-service', () => ({
  cleanupToMakeRoom: mock(() => Promise.resolve({ removed: [] })),
  getWorktreeStatusBreakdown: mock(() => Promise.resolve({ active: 0, stale: 0, merged: 0 })),
  STALE_THRESHOLD_DAYS: 7,
}));

// Mock @archon/isolation — shared resolve mock so tests can control return values
const mockResolve = mock(() => Promise.resolve({ status: 'none' as const, cwd: '/workspace' }));

class MockIsolationResolver {
  resolve = mockResolve;
  constructor(_deps: unknown) {}
}

mock.module('@archon/isolation', () => ({
  IsolationResolver: MockIsolationResolver,
  IsolationBlockedError: class IsolationBlockedError extends Error {
    constructor(
      message: string,
      public reason?: string
    ) {
      super(message);
      this.name = 'IsolationBlockedError';
    }
  },
  configureIsolation: mock(() => undefined),
  getIsolationProvider: mock(() => ({})),
}));

mock.module('./prompt-builder', () => ({
  buildOrchestratorPrompt: mock(() => 'prompt'),
  buildProjectScopedPrompt: mock(() => 'prompt'),
}));

mock.module('../utils/error-formatter', () => ({
  classifyAndFormatError: mock((err: Error) => `⚠️ Error: ${err.message}`),
}));

mock.module('@archon/workflows/workflow-discovery', () => ({
  discoverWorkflowsWithConfig: mock(() => Promise.resolve({ workflows: [], errors: [] })),
}));
mock.module('@archon/workflows/executor', () => ({
  executeWorkflow: mock(() =>
    Promise.resolve({ success: true, summary: null, workflowRunId: 'run-1' })
  ),
}));
mock.module('@archon/workflows/router', () => ({
  findWorkflow: mock(() => undefined),
}));
mock.module('@archon/workflows/utils/tool-formatter', () => ({
  formatToolCall: mock(() => ''),
}));

mock.module('fs', () => ({
  existsSync: mock(() => true),
}));

mock.module('../services/title-generator', () => ({
  generateAndSetTitle: mock(() => Promise.resolve()),
}));

// ─── Import module under test AFTER all mocks ────────────────────────────────

const { dispatchBackgroundWorkflow, validateAndResolveIsolation } = await import('./orchestrator');

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeEnvRow(overrides?: Partial<IsolationEnvironmentRow>): IsolationEnvironmentRow {
  return {
    id: 'env-1',
    codebase_id: 'cb-1',
    workflow_type: 'issue',
    workflow_id: '42',
    provider: 'worktree',
    working_path: '/worktrees/issue-42',
    branch_name: 'issue-42',
    status: 'active',
    created_at: new Date(),
    created_by_platform: 'web',
    metadata: {},
    ...overrides,
  };
}

function makeConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv-1',
    platform_type: 'web',
    platform_conversation_id: 'web-conv-1',
    codebase_id: 'cb-1',
    cwd: '/workspace',
    isolation_env_id: null,
    ai_assistant_type: 'claude',
    title: null,
    hidden: false,
    task_id: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeCodebase(overrides?: Partial<Codebase>): Codebase {
  return {
    id: 'cb-1',
    name: 'test-repo',
    default_cwd: '/workspace/test-repo',
    commands: {},
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateAndResolveIsolation', () => {
  let platform: MockPlatformAdapter;

  beforeEach(() => {
    platform = new MockPlatformAdapter();
    mockUpdateConversation.mockClear();
    mockResolve.mockClear();
  });

  test('linked_issue_reuse triggers reuse message', async () => {
    const conversation = makeConversation();
    const codebase = makeCodebase();

    mockResolve.mockResolvedValueOnce({
      status: 'resolved',
      env: makeEnvRow(),
      cwd: '/worktrees/issue-42',
      method: { type: 'linked_issue_reuse', issueNumber: 99 },
    });

    const result = await validateAndResolveIsolation(conversation, codebase, platform, 'conv-1');

    expect(platform.sendMessage).toHaveBeenCalledWith('conv-1', 'Reusing worktree from issue #99');
    expect(result.status).toBe('new');
  });

  test('created with autoCleanedCount triggers cleanup message', async () => {
    const conversation = makeConversation();
    const codebase = makeCodebase();

    mockResolve.mockResolvedValueOnce({
      status: 'resolved',
      env: makeEnvRow(),
      cwd: '/worktrees/issue-42',
      method: { type: 'created', autoCleanedCount: 3 },
    });

    const result = await validateAndResolveIsolation(conversation, codebase, platform, 'conv-1');

    expect(platform.sendMessage).toHaveBeenCalledWith(
      'conv-1',
      'Cleaned up 3 merged worktree(s) to make room.'
    );
    expect(result.status).toBe('new');
  });
});

describe('dispatchBackgroundWorkflow', () => {
  let platform: MockPlatformAdapter;

  beforeEach(() => {
    platform = new MockPlatformAdapter();
    mockGetOrCreateConversation.mockClear();
    mockGetConversationById.mockClear();
    mockUpdateConversation.mockClear();
    mockGetCodebase.mockClear();
    mockCreateWorkflowRun.mockClear();

    mockGetOrCreateConversation.mockResolvedValue(makeConversation({ id: 'worker-conv-1' }));
    mockGetConversationById.mockResolvedValue(
      makeConversation({ id: 'parent-conv-1', task_id: 'task-1' })
    );
    mockCreateWorkflowRun.mockResolvedValue({ id: 'run-1' });
  });

  test('keeps worker conversations scoped to the parent task', async () => {
    await dispatchBackgroundWorkflow(
      {
        platform,
        conversationId: 'parent-platform-conv',
        conversationDbId: 'parent-conv-1',
        cwd: '/workspace',
        codebaseId: null,
        originalMessage: 'review this PR',
      },
      {
        name: 'archon-smart-pr-review',
        description: 'Review a PR',
        steps: [],
      }
    );

    expect(mockGetConversationById).toHaveBeenCalledWith('parent-conv-1');
    expect(mockUpdateConversation).toHaveBeenCalledWith('worker-conv-1', {
      cwd: '/workspace',
      codebase_id: null,
      task_id: 'task-1',
      hidden: true,
    });
  });

  test('propagates null task_id when parent has no task', async () => {
    mockGetConversationById.mockResolvedValueOnce(
      makeConversation({ id: 'parent-conv-1', task_id: null })
    );
    mockGetOrCreateConversation.mockResolvedValueOnce(makeConversation({ id: 'worker-conv-2' }));

    await dispatchBackgroundWorkflow(
      {
        platform,
        conversationId: 'parent-platform-conv',
        conversationDbId: 'parent-conv-1',
        cwd: '/workspace',
        codebaseId: null,
        originalMessage: 'review this PR',
      },
      { name: 'archon-smart-pr-review', description: 'Review a PR', steps: [] }
    );

    expect(mockUpdateConversation).toHaveBeenCalledWith('worker-conv-2', {
      cwd: '/workspace',
      codebase_id: null,
      task_id: null,
      hidden: true,
    });
  });

  test('propagates DB errors from parent-conversation lookup (no silent fallback)', async () => {
    // Lookup throwing must NOT be silently caught — the worker would otherwise
    // be persisted with task_id=null and disappear from the task UI.
    mockGetConversationById.mockRejectedValueOnce(new Error('db unavailable'));
    mockGetOrCreateConversation.mockResolvedValueOnce(makeConversation({ id: 'worker-conv-3' }));

    await expect(
      dispatchBackgroundWorkflow(
        {
          platform,
          conversationId: 'parent-platform-conv',
          conversationDbId: 'parent-conv-1',
          cwd: '/workspace',
          codebaseId: null,
          originalMessage: 'review this PR',
        },
        { name: 'archon-smart-pr-review', description: 'Review a PR', steps: [] }
      )
    ).rejects.toThrow('db unavailable');

    // updateConversation must NOT have been called with a silently-stripped
    // task_id — the throw must short-circuit before reaching it.
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });
});

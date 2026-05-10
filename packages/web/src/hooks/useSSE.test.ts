import { describe, test, expect, mock } from 'bun:test';
import { dispatchSSEEvent, type SSEHandlers, type SSEBufferOps } from './useSSE';
import type { SSEEvent, WorkflowToolActivityEvent } from '@/lib/types';

function makeBuffer(): SSEBufferOps & { calls: Record<string, number> } {
  const calls: Record<string, number> = {
    appendText: 0,
    flushIfPending: 0,
    clearBuffer: 0,
  };
  return {
    calls,
    appendText: (): void => {
      calls.appendText += 1;
    },
    flushIfPending: (): void => {
      calls.flushIfPending += 1;
    },
    clearBuffer: (): void => {
      calls.clearBuffer += 1;
    },
  };
}

function makeHandlers(): SSEHandlers {
  return {
    onText: mock(() => {}),
    onToolCall: mock(() => {}),
    onToolResult: mock(() => {}),
    onError: mock(() => {}),
    onLockChange: mock(() => {}),
    onSessionInfo: mock(() => {}),
    onWorkflowStatus: mock(() => {}),
    onWorkflowArtifact: mock(() => {}),
    onDagNode: mock(() => {}),
    onLoopIteration: mock(() => {}),
    onToolActivity: mock(() => {}),
    onWorkflowDispatch: mock(() => {}),
    onWorkflowOutputPreview: mock(() => {}),
    onWarning: mock(() => {}),
    onRetract: mock(() => {}),
    onSystemStatus: mock(() => {}),
  };
}

describe('dispatchSSEEvent — workflow_tool_activity', () => {
  test('invokes onToolActivity with the full event payload', () => {
    const handlers = makeHandlers();
    const buffer = makeBuffer();
    const event: WorkflowToolActivityEvent = {
      type: 'workflow_tool_activity',
      timestamp: 1_700_000_000_000,
      runId: 'run-123',
      toolName: 'Bash',
      stepName: 'lint',
      status: 'started',
    };

    dispatchSSEEvent(event, handlers, buffer);

    const onToolActivity = handlers.onToolActivity as ReturnType<typeof mock>;
    expect(onToolActivity).toHaveBeenCalledTimes(1);
    expect(onToolActivity).toHaveBeenCalledWith(event);
  });

  test('forwards completed-status payload (with durationMs) verbatim', () => {
    const handlers = makeHandlers();
    const buffer = makeBuffer();
    const event: WorkflowToolActivityEvent = {
      type: 'workflow_tool_activity',
      timestamp: 1_700_000_000_001,
      runId: 'run-456',
      toolName: 'Read',
      stepName: 'analyze',
      status: 'completed',
      durationMs: 1234,
    };

    dispatchSSEEvent(event, handlers, buffer);

    const onToolActivity = handlers.onToolActivity as ReturnType<typeof mock>;
    expect(onToolActivity).toHaveBeenCalledTimes(1);
    expect(onToolActivity).toHaveBeenCalledWith(event);
  });

  test('does not throw when onToolActivity handler is undefined', () => {
    const handlers = makeHandlers();
    handlers.onToolActivity = undefined;
    const buffer = makeBuffer();
    const event: WorkflowToolActivityEvent = {
      type: 'workflow_tool_activity',
      timestamp: 1_700_000_000_002,
      runId: 'run-789',
      toolName: 'Edit',
      stepName: 'apply-fix',
      status: 'started',
    };

    expect(() => dispatchSSEEvent(event, handlers, buffer)).not.toThrow();
  });

  test('does not touch the text buffer for tool-activity events', () => {
    const handlers = makeHandlers();
    const buffer = makeBuffer();
    const event: WorkflowToolActivityEvent = {
      type: 'workflow_tool_activity',
      timestamp: 1_700_000_000_003,
      runId: 'run-101',
      toolName: 'Grep',
      stepName: 'search',
      status: 'completed',
      durationMs: 42,
    };

    dispatchSSEEvent(event, handlers, buffer);

    expect(buffer.calls.appendText).toBe(0);
    expect(buffer.calls.flushIfPending).toBe(0);
    expect(buffer.calls.clearBuffer).toBe(0);
  });

  test('does not invoke unrelated handlers', () => {
    const handlers = makeHandlers();
    const buffer = makeBuffer();
    const event: WorkflowToolActivityEvent = {
      type: 'workflow_tool_activity',
      timestamp: 1_700_000_000_004,
      runId: 'run-202',
      toolName: 'Write',
      stepName: 'persist',
      status: 'started',
    };

    dispatchSSEEvent(event, handlers, buffer);

    expect(handlers.onText as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(handlers.onToolCall as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(handlers.onToolResult as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(handlers.onWorkflowDispatch as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(handlers.onLoopIteration as ReturnType<typeof mock>).not.toHaveBeenCalled();
  });
});

describe('dispatchSSEEvent — heartbeat (sanity check that the switch routes correctly)', () => {
  test('does nothing for heartbeat events', () => {
    const handlers = makeHandlers();
    const buffer = makeBuffer();
    const event = { type: 'heartbeat' } as unknown as SSEEvent;

    dispatchSSEEvent(event, handlers, buffer);

    expect(buffer.calls.appendText).toBe(0);
    expect(buffer.calls.flushIfPending).toBe(0);
    expect(buffer.calls.clearBuffer).toBe(0);
    expect(handlers.onToolActivity as ReturnType<typeof mock>).not.toHaveBeenCalled();
  });
});

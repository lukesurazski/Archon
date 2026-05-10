import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  SSEEvent,
  ErrorDisplay,
  LoopIterationEvent,
  WorkflowStatusEvent,
  WorkflowArtifactEvent,
  WorkflowDispatchEvent,
  WorkflowOutputPreviewEvent,
  WorkflowToolActivityEvent,
  DagNodeEvent,
} from '@/lib/types';
import { SSE_BASE_URL } from '@/lib/api';

export function parseSSEEvent(raw: string): SSEEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed.type !== 'string') {
      console.error('[SSE] Malformed event: missing type field', { raw });
      return null;
    }
    return parsed as unknown as SSEEvent;
  } catch (parseErr) {
    console.error('[SSE] Failed to parse event:', {
      raw,
      error: (parseErr as Error).message,
    });
    return null;
  }
}

export interface SSEHandlers {
  onText: (content: string, workflowResult?: { workflowName: string; runId: string }) => void;
  onToolCall: (name: string, input: Record<string, unknown>, toolCallId?: string) => void;
  onToolResult: (name: string, output: string, duration: number, toolCallId?: string) => void;
  onError: (error: ErrorDisplay) => void;
  onLockChange: (locked: boolean, queuePosition?: number) => void;
  onSessionInfo: (sessionId: string, cost?: number) => void;
  onWorkflowStatus?: (event: WorkflowStatusEvent) => void;
  onWorkflowArtifact?: (event: WorkflowArtifactEvent) => void;
  onDagNode?: (event: DagNodeEvent) => void;
  onLoopIteration?: (event: LoopIterationEvent) => void;
  onToolActivity?: (event: WorkflowToolActivityEvent) => void;
  onWorkflowDispatch?: (event: WorkflowDispatchEvent) => void;
  onWorkflowOutputPreview?: (event: WorkflowOutputPreviewEvent) => void;
  onWarning?: (message: string) => void;
  onRetract?: () => void;
  onSystemStatus?: (content: string) => void;
}

/**
 * Buffer operations passed into `dispatchSSEEvent`. Encapsulates the text-batching
 * primitives owned by `useSSE` so the dispatcher itself can be unit-tested without
 * mounting React or simulating timers.
 */
export interface SSEBufferOps {
  /** Append text content to the buffer; debounced flush is owned by the caller. */
  appendText: (content: string, workflowResult?: { workflowName: string; runId: string }) => void;
  /** Synchronously flush any buffered text. No-op if the buffer is empty. */
  flushIfPending: () => void;
  /** Discard buffered text and any pending workflow-result pointer without flushing. */
  clearBuffer: () => void;
}

/**
 * Pure dispatcher for parsed SSE events. The hook holds the `SSEBufferOps` (text
 * batching state lives in refs), but the event-routing switch is extracted here
 * so individual branches — including `workflow_tool_activity` — can be exercised
 * directly in unit tests.
 */
export function dispatchSSEEvent(
  data: SSEEvent,
  handlers: SSEHandlers,
  buffer: SSEBufferOps
): void {
  switch (data.type) {
    case 'text': {
      const workflowResult =
        'workflowResult' in data && data.workflowResult && typeof data.workflowResult === 'object'
          ? (data.workflowResult as { workflowName: string; runId: string })
          : undefined;
      buffer.appendText(data.content, workflowResult);
      break;
    }
    case 'tool_call':
      buffer.flushIfPending();
      handlers.onToolCall(data.name, data.input, data.toolCallId);
      break;
    case 'tool_result':
      buffer.flushIfPending();
      handlers.onToolResult(data.name, data.output, data.duration, data.toolCallId);
      break;
    case 'error':
      handlers.onError({
        message: data.message,
        classification: data.classification ?? 'transient',
        suggestedActions: data.suggestedActions ?? [],
      });
      break;
    case 'conversation_lock':
      if (!data.locked) {
        buffer.flushIfPending();
      }
      handlers.onLockChange(data.locked, data.queuePosition);
      break;
    case 'session_info':
      handlers.onSessionInfo(data.sessionId, data.cost);
      break;
    case 'workflow_status':
      handlers.onWorkflowStatus?.(data);
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        handlers.onLockChange(false);
      }
      break;
    case 'workflow_artifact':
      handlers.onWorkflowArtifact?.(data);
      break;
    case 'dag_node':
      handlers.onDagNode?.(data);
      break;
    case 'workflow_step':
      handlers.onLoopIteration?.(data);
      break;
    case 'workflow_dispatch':
      buffer.flushIfPending();
      handlers.onWorkflowDispatch?.(data);
      break;
    case 'workflow_output_preview':
      handlers.onWorkflowOutputPreview?.(data);
      break;
    case 'workflow_tool_activity':
      handlers.onToolActivity?.(data);
      break;
    case 'warning':
      handlers.onWarning?.(data.message);
      break;
    case 'system_status':
      handlers.onSystemStatus?.(data.content);
      break;
    case 'retract':
      buffer.clearBuffer();
      handlers.onRetract?.();
      break;
    case 'heartbeat':
      break;
    default: {
      console.warn('[SSE] Unknown event type', { type: (data as { type: string }).type });
      break;
    }
  }
}

export function useSSE(
  conversationId: string | null,
  handlers: SSEHandlers
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Text batching: accumulate text for 50ms before dispatching
  const textBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWorkflowResultRef = useRef<{ workflowName: string; runId: string } | undefined>(
    undefined
  );

  const flushText = useCallback((): void => {
    if (textBufferRef.current) {
      handlersRef.current.onText(textBufferRef.current, pendingWorkflowResultRef.current);
      textBufferRef.current = '';
      pendingWorkflowResultRef.current = undefined;
    }
    flushTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    const eventSource = new EventSource(
      `${SSE_BASE_URL}/api/stream/${encodeURIComponent(conversationId)}`
    );

    eventSource.onopen = (): void => {
      setConnected(true);
    };

    eventSource.onerror = (): void => {
      // Only mark disconnected when the connection is permanently closed,
      // not during transient CONNECTING reconnection attempts (prevents flicker)
      if (eventSource.readyState === EventSource.CLOSED) {
        setConnected(false);
        handlersRef.current.onError({
          message: 'Lost connection to server. Please refresh the page.',
          classification: 'transient',
          suggestedActions: ['Refresh the page', 'Check that the server is running'],
        });
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        console.warn('[SSE] Connection error, reconnecting...', { conversationId });
      }
    };

    eventSource.onmessage = (event: MessageEvent): void => {
      const data = parseSSEEvent(event.data as string);
      if (!data) {
        handlersRef.current.onError({
          message: 'Received malformed response from server',
          classification: 'transient',
          suggestedActions: ['Refresh the page if chat appears stuck'],
        });
        return;
      }

      try {
        const h = handlersRef.current;

        const buffer: SSEBufferOps = {
          appendText: (content, workflowResult) => {
            textBufferRef.current += content;
            if (workflowResult) {
              pendingWorkflowResultRef.current = workflowResult;
            }
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(flushText, 50);
            }
          },
          flushIfPending: () => {
            if (textBufferRef.current) {
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              flushText();
            }
          },
          clearBuffer: () => {
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            textBufferRef.current = '';
            pendingWorkflowResultRef.current = undefined;
          },
        };

        dispatchSSEEvent(data, h, buffer);
      } catch (handlerError) {
        console.error('[SSE] Handler error for event type:', data.type, handlerError);
        try {
          handlersRef.current.onError({
            message: `Failed to process ${data.type} event. UI may be out of sync.`,
            classification: 'transient',
            suggestedActions: ['Refresh the page if chat appears stuck'],
          });
        } catch {
          // Avoid infinite loop if onError itself throws
        }
      }
    };

    return (): void => {
      eventSource.close();
      setConnected(false);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushText();
      }
    };
  }, [conversationId, flushText]);

  return { connected };
}

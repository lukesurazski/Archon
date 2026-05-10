import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Loader2, Play, RotateCcw, Square } from 'lucide-react';
import {
  cancelWorkflowRun,
  createConversation,
  deleteConversation,
  listWorkflowRuns,
  listWorkflows,
  runWorkflow,
} from '@/lib/api';
import { useDashboardSSE } from '@/hooks/useDashboardSSE';
import type { TaskDetailResponse, WorkflowListEntry, WorkflowRunResponse } from '@/lib/api';
import {
  formatInputType,
  getInputPlaceholder,
  getTaskDefaultForInputs,
} from '@/lib/task-input-defaults';
import type { WorkflowState } from '@/lib/types';
import { useWorkflowStore } from '@/stores/workflow-store';
import { cn } from '@/lib/utils';

interface TaskWorkflowRunnerProps {
  task: TaskDetailResponse;
  cwd?: string;
}

function statusClass(status: string): string {
  return cn(
    status === 'running' && 'bg-primary/15 text-primary',
    status === 'completed' && 'bg-success/15 text-success',
    status === 'failed' && 'bg-destructive/15 text-destructive',
    (status === 'pending' || status === 'paused') && 'bg-warning/15 text-warning',
    status === 'cancelled' && 'bg-surface-secondary text-text-tertiary'
  );
}

function isActiveRun(status: WorkflowRunResponse['status']): boolean {
  return status === 'running' || status === 'pending' || status === 'paused';
}

function formatStartedAt(run: WorkflowRunResponse): string {
  return new Date(
    run.started_at.endsWith('Z') ? run.started_at : `${run.started_at}Z`
  ).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getRunProgress(
  liveRun: WorkflowState | undefined,
  status: WorkflowRunResponse['status']
): {
  completed: number;
  failed: number;
  failureError: string | null;
  failureLabel: string | null;
  label: string | null;
  percent: number;
  total: number;
} {
  const nodes = liveRun?.dagNodes ?? [];
  const total = nodes.length;
  const completed = nodes.filter(
    node => node.status === 'completed' || node.status === 'skipped'
  ).length;
  const failedNodes = nodes.filter(node => node.status === 'failed');
  const runningNode = nodes.find(node => node.status === 'running');
  const failedNode = failedNodes[0];
  const active = isActiveRun(status);
  const percent =
    total > 0
      ? Math.max(active ? 8 : 0, Math.round((completed / total) * 100))
      : status === 'completed'
        ? 100
        : active
          ? 8
          : 0;

  if (total > 0) {
    const detailNode = runningNode ?? failedNode;
    return {
      completed,
      failed: failedNodes.length,
      failureError: failedNode?.error ?? null,
      failureLabel: failedNode?.name ?? null,
      total,
      percent,
      label: detailNode ? detailNode.name : `${completed}/${total} steps`,
    };
  }

  if (liveRun?.currentTool?.status === 'running') {
    return {
      completed,
      failed: failedNodes.length,
      failureError: failedNode?.error ?? null,
      failureLabel: failedNode?.name ?? null,
      total,
      percent,
      label: `Running ${liveRun.currentTool.name}`,
    };
  }

  if (active) {
    return {
      completed,
      failed: failedNodes.length,
      failureError: failedNode?.error ?? null,
      failureLabel: failedNode?.name ?? null,
      total,
      percent,
      label: 'Starting workflow...',
    };
  }
  return {
    completed,
    failed: failedNodes.length,
    failureError: failedNode?.error ?? null,
    failureLabel: failedNode?.name ?? null,
    total,
    percent,
    label: null,
  };
}

function RunningGlyph(): React.ReactElement {
  return (
    <span
      aria-label="Workflow is running"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    </span>
  );
}

export function TaskWorkflowRunner({ task, cwd }: TaskWorkflowRunnerProps): React.ReactElement {
  useDashboardSSE();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workflowStates = useWorkflowStore(state => state.workflows);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [workflowSearch, setWorkflowSearch] = useState('');
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const workflowPickerBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoFilledMessage = useRef('');

  const { data: workflows, isError: workflowsError } = useQuery({
    queryKey: ['workflows', cwd ?? null],
    queryFn: () => listWorkflows(cwd),
    refetchInterval: 30_000,
  });

  const { data: runs, refetch: refetchRuns } = useQuery({
    queryKey: ['workflow-runs', { taskId: task.id }],
    queryFn: () => listWorkflowRuns({ taskId: task.id, limit: 25 }),
    initialData: task.workflow_runs,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: query => {
      const currentRuns = query.state.data ?? [];
      const hasActiveRun = currentRuns.some(run =>
        isActiveRun(workflowStates.get(run.id)?.status ?? run.status)
      );
      return hasActiveRun ? 3_000 : 15_000;
    },
  });

  const sortedWorkflows = useMemo(
    () => [...(workflows ?? [])].sort((a, b) => a.workflow.name.localeCompare(b.workflow.name)),
    [workflows]
  );

  const filteredWorkflows = useMemo((): WorkflowListEntry[] => {
    const query = workflowSearch.trim().toLowerCase();
    if (!query) return sortedWorkflows;
    return sortedWorkflows.filter(entry => {
      const name = entry.workflow.name.toLowerCase();
      const source = entry.source.toLowerCase();
      const inputText = (entry.workflow.inputs ?? [])
        .map(input => `${input.name} ${input.type} ${input.label ?? ''}`)
        .join(' ')
        .toLowerCase();
      return name.includes(query) || source.includes(query) || inputText.includes(query);
    });
  }, [sortedWorkflows, workflowSearch]);

  const selectedWorkflowEntry = sortedWorkflows.find(
    entry => entry.workflow.name === selectedWorkflow
  );
  const selectedWorkflowInputs = selectedWorkflowEntry?.workflow.inputs ?? [];
  const primaryWorkflowInput = selectedWorkflowInputs[0];
  const taskDefaultMessage = getTaskDefaultForInputs(task, selectedWorkflowInputs);

  useEffect(() => {
    if (!selectedWorkflow || !taskDefaultMessage) return;
    setMessage(current => {
      if (current.trim() !== '' && current !== lastAutoFilledMessage.current) return current;
      lastAutoFilledMessage.current = taskDefaultMessage;
      return taskDefaultMessage;
    });
  }, [selectedWorkflow, taskDefaultMessage]);

  function selectWorkflow(entry: WorkflowListEntry): void {
    setSelectedWorkflow(entry.workflow.name);
    setWorkflowSearch(entry.workflow.name);
    setWorkflowPickerOpen(false);
    const defaultMessage = getTaskDefaultForInputs(task, entry.workflow.inputs ?? []);
    setMessage(current => {
      if (!defaultMessage) return current;
      if (current.trim() !== '' && current !== lastAutoFilledMessage.current) return current;
      lastAutoFilledMessage.current = defaultMessage;
      return defaultMessage;
    });
  }

  function refreshTaskWorkflowData(): void {
    void refetchRuns();
    void queryClient.invalidateQueries({ queryKey: ['workflow-runs', { taskId: task.id }] });
    void queryClient.invalidateQueries({ queryKey: ['task', task.id] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }

  function scheduleWorkflowHistoryRefresh(): void {
    refreshTaskWorkflowData();
    for (const delay of [500, 1_500, 3_000, 6_000, 10_000]) {
      setTimeout(refreshTaskWorkflowData, delay);
    }
  }

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkflow || !message.trim()) {
        throw new Error('Workflow and input are required');
      }
      let conversationId: string | undefined;
      let workflowStarted = false;
      try {
        ({ conversationId } = await createConversation(
          task.codebase_id ?? undefined,
          undefined,
          task.id
        ));
        await runWorkflow(selectedWorkflow, conversationId, message.trim());
        workflowStarted = true;
        return conversationId;
      } catch (err) {
        if (conversationId && !workflowStarted) {
          void deleteConversation(conversationId).catch(cleanupErr => {
            console.warn('[TaskWorkflowRunner] Failed to clean up orphan conversation', {
              conversationId,
              cleanupErr,
            });
          });
        }
        throw err;
      }
    },
    onSuccess: conversationId => {
      setSelectedWorkflow('');
      setWorkflowSearch('');
      setMessage('');
      setError(null);
      scheduleWorkflowHistoryRefresh();
      if (conversationId) {
        navigate(
          `/chat/tasks/${encodeURIComponent(task.id)}/chats/${encodeURIComponent(conversationId)}`
        );
      }
    },
    onError: err => {
      setError(err instanceof Error ? err.message : 'Failed to start workflow');
    },
  });

  const rerunMutation = useMutation({
    mutationFn: async (run: WorkflowRunResponse) => {
      setRerunningRunId(run.id);
      let conversationId: string | undefined;
      let workflowStarted = false;
      try {
        ({ conversationId } = await createConversation(
          task.codebase_id ?? undefined,
          undefined,
          task.id
        ));
        await runWorkflow(run.workflow_name, conversationId, run.user_message, {
          forceFresh: true,
        });
        workflowStarted = true;
      } catch (err) {
        if (conversationId && !workflowStarted) {
          void deleteConversation(conversationId).catch(cleanupErr => {
            console.warn('[TaskWorkflowRunner] Failed to clean up orphan rerun conversation', {
              conversationId,
              cleanupErr,
            });
          });
        }
        throw err;
      }
    },
    onSuccess: () => {
      setError(null);
      scheduleWorkflowHistoryRefresh();
    },
    onError: err => {
      setError(err instanceof Error ? err.message : 'Failed to rerun workflow');
    },
    onSettled: () => {
      setRerunningRunId(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (run: WorkflowRunResponse) => {
      setCancellingRunId(run.id);
      await cancelWorkflowRun(run.id);
    },
    onSuccess: () => {
      setError(null);
      scheduleWorkflowHistoryRefresh();
    },
    onError: err => {
      setError(err instanceof Error ? err.message : 'Failed to stop workflow');
    },
    onSettled: () => {
      setCancellingRunId(null);
    },
  });

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Run Workflow</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          Starts a new conversation scoped to this task.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {workflowsError && <p className="text-xs text-error">Failed to load workflows.</p>}
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <div className="relative">
            <div className="relative">
              <input
                value={workflowSearch}
                onFocus={(): void => {
                  if (workflowPickerBlurTimeout.current) {
                    clearTimeout(workflowPickerBlurTimeout.current);
                    workflowPickerBlurTimeout.current = null;
                  }
                  setWorkflowPickerOpen(true);
                }}
                onBlur={(): void => {
                  workflowPickerBlurTimeout.current = setTimeout(() => {
                    setWorkflowPickerOpen(false);
                  }, 120);
                }}
                onChange={(e): void => {
                  const value = e.target.value;
                  setWorkflowSearch(value);
                  setWorkflowPickerOpen(true);
                  if (value !== selectedWorkflow) setSelectedWorkflow('');
                }}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    if (!selectedWorkflow && filteredWorkflows[0]) {
                      e.preventDefault();
                      selectWorkflow(filteredWorkflows[0]);
                    }
                  } else if (e.key === 'Escape') {
                    setWorkflowPickerOpen(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setWorkflowPickerOpen(true);
                  }
                }}
                placeholder="Search workflows..."
                role="combobox"
                aria-expanded={workflowPickerOpen}
                aria-controls="task-workflow-picker-list"
                aria-autocomplete="list"
                className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 pr-9 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary"
              />
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            </div>
            {workflowPickerOpen && (
              <div
                id="task-workflow-picker-list"
                role="listbox"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface-elevated shadow-lg"
              >
                {filteredWorkflows.length > 0 ? (
                  filteredWorkflows.map(entry => (
                    <button
                      key={`${entry.source}:${entry.workflow.name}`}
                      type="button"
                      role="option"
                      aria-selected={selectedWorkflow === entry.workflow.name}
                      onMouseDown={(e): void => {
                        e.preventDefault();
                        selectWorkflow(entry);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-secondary',
                        selectedWorkflow === entry.workflow.name && 'bg-accent-muted text-primary'
                      )}
                    >
                      <span className="min-w-0 truncate text-text-primary">
                        {entry.workflow.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {(entry.workflow.inputs ?? []).slice(0, 2).map(input => (
                          <span
                            key={`${entry.workflow.name}:${input.name}`}
                            className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                          >
                            {input.label ?? formatInputType(input.type)}
                          </span>
                        ))}
                        <span className="rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                          {entry.source}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-3 text-sm text-text-tertiary">No workflows found.</div>
                )}
              </div>
            )}
          </div>
          <input
            value={message}
            onChange={(e): void => {
              setMessage(e.target.value);
              if (e.target.value !== lastAutoFilledMessage.current) {
                lastAutoFilledMessage.current = '';
              }
            }}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' && selectedWorkflow && message.trim()) {
                e.preventDefault();
                runMutation.mutate();
              }
            }}
            placeholder={getInputPlaceholder(primaryWorkflowInput)}
            className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary"
          />
          <button
            onClick={(): void => {
              runMutation.mutate();
            }}
            disabled={!selectedWorkflow || !message.trim() || runMutation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run
          </button>
        </div>
        {selectedWorkflowInputs.length > 0 && (
          <div className="rounded-md border border-border bg-surface-elevated px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              Expected Input
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedWorkflowInputs.map(input => (
                <span
                  key={input.name}
                  title={input.description}
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {input.label ?? formatInputType(input.type)}
                  {input.required ? ' required' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-xs text-error">{error}</p>}
      </div>

      <div className="border-t border-border px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          Workflow History
        </h3>
        <div className="overflow-hidden rounded-lg border border-border bg-surface-elevated/30">
          {runs && runs.length > 0 ? (
            <div className="divide-y divide-border/70">
              {runs.map(run => {
                const liveRun = workflowStates.get(run.id);
                const status = liveRun?.status ?? run.status;
                const active = isActiveRun(status);
                const progress = getRunProgress(liveRun, status);
                const isCancelling = cancellingRunId === run.id;
                const isRerunning = rerunningRunId === run.id;
                return (
                  <div
                    key={run.id}
                    className={cn(
                      'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-secondary/25',
                      active && 'bg-primary/5',
                      progress.failed > 0 && 'border-l-2 border-destructive/60'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                          active && 'bg-primary/10'
                        )}
                      >
                        <span
                          className={cn(
                            'relative h-2.5 w-2.5 rounded-full',
                            status === 'running' && 'bg-primary',
                            status === 'completed' && 'bg-success',
                            status === 'failed' && 'bg-destructive',
                            (status === 'pending' || status === 'paused') && 'bg-warning',
                            status === 'cancelled' && 'bg-text-tertiary'
                          )}
                        />
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            to={`/workflows/runs/${run.id}`}
                            className="truncate text-sm font-semibold leading-5 text-text-primary hover:text-primary"
                            title={`Open workflow run ${run.id}`}
                          >
                            {run.workflow_name}
                          </Link>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              statusClass(status)
                            )}
                          >
                            {status}
                          </span>
                          {progress.failed > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive/90"
                              title={progress.failureError ?? undefined}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {progress.failed} failed
                            </span>
                          )}
                          {active && <RunningGlyph />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                          <span className="font-mono">{run.id.slice(0, 8)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{formatStartedAt(run)}</span>
                        </div>
                        {progress.failed > 0 && (
                          <div className="mt-1 flex max-w-xl items-start gap-1.5 text-[11px] font-medium text-text-secondary">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive/80" />
                            <span className="min-w-0 truncate">
                              {progress.failureLabel ?? 'A workflow step failed'}
                              {progress.failureError ? `: ${progress.failureError}` : ''}
                            </span>
                          </div>
                        )}
                        {(active || progress.total > 0) && (
                          <div className="mt-2 max-w-xl">
                            <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-text-tertiary">
                              <span className="truncate">
                                {progress.label ?? 'Workflow progress'}
                              </span>
                              {progress.total > 0 && (
                                <span className="shrink-0 font-mono tabular-nums">
                                  {progress.completed}/{progress.total}
                                </span>
                              )}
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-surface-secondary">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all duration-500',
                                  (status === 'failed' || progress.failed > 0) &&
                                    'bg-destructive/70',
                                  status === 'completed' && 'bg-success',
                                  status !== 'failed' &&
                                    progress.failed === 0 &&
                                    status !== 'completed' &&
                                    'bg-primary'
                                )}
                                style={{ width: `${progress.percent}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-1.5">
                      <Link
                        to={`/workflows/runs/${run.id}`}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-primary hover:border-primary/50 hover:bg-primary/10"
                      >
                        Graph
                      </Link>
                      {active ? (
                        <button
                          type="button"
                          onClick={(): void => {
                            cancelMutation.mutate(run);
                          }}
                          disabled={isCancelling}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:border-error/40 hover:bg-error/10 hover:text-error disabled:cursor-wait disabled:opacity-60"
                          title={`Stop workflow run ${run.id}`}
                        >
                          {isCancelling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          Stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(): void => {
                            rerunMutation.mutate(run);
                          }}
                          disabled={isRerunning}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-60"
                          title={`Run ${run.workflow_name} again with the same input`}
                        >
                          {isRerunning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Run again
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-4 text-sm text-text-tertiary">
              No workflows have run for this task.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, Play } from 'lucide-react';
import {
  createConversation,
  deleteConversation,
  listWorkflowRuns,
  listWorkflows,
  runWorkflow,
} from '@/lib/api';
import type { TaskDetailResponse, WorkflowListEntry, WorkflowRunResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TaskWorkflowRunnerProps {
  task: TaskDetailResponse;
  cwd?: string;
}

type WorkflowInputMetadata = NonNullable<WorkflowListEntry['workflow']['inputs']>[number];

function statusClass(status: string): string {
  return cn(
    status === 'running' && 'bg-primary/15 text-primary',
    status === 'completed' && 'bg-success/15 text-success',
    status === 'failed' && 'bg-destructive/15 text-destructive',
    (status === 'pending' || status === 'paused') && 'bg-warning/15 text-warning',
    status === 'cancelled' && 'bg-surface-secondary text-text-tertiary'
  );
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

function formatInputType(type: WorkflowInputMetadata['type']): string {
  switch (type) {
    case 'pull_request':
      return 'Pull request';
    case 'branch':
      return 'Branch';
    case 'path':
      return 'Path';
    case 'issue':
      return 'Issue';
    case 'number':
      return 'Number';
    case 'text':
      return 'Text';
  }
}

function getInputPlaceholder(input?: WorkflowInputMetadata): string {
  if (!input) return 'Workflow input / arguments';
  if (input.placeholder) return input.placeholder;
  switch (input.type) {
    case 'pull_request':
      return 'PR number or URL, e.g. 123 or https://github.com/owner/repo/pull/123';
    case 'branch':
      return 'Branch name, e.g. feat/task-container-workspace';
    case 'path':
      return 'File or directory path, e.g. .agents/plans/my-plan.md';
    case 'issue':
      return 'Issue number or URL, e.g. 456 or https://github.com/owner/repo/issues/456';
    case 'number':
      return 'Numeric input';
    case 'text':
      return 'Workflow input / arguments';
  }
}

export function TaskWorkflowRunner({ task, cwd }: TaskWorkflowRunnerProps): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [workflowSearch, setWorkflowSearch] = useState('');
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const workflowPickerBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: workflows, isError: workflowsError } = useQuery({
    queryKey: ['workflows', cwd ?? null],
    queryFn: () => listWorkflows(cwd),
    refetchInterval: 30_000,
  });

  const { data: runs } = useQuery({
    queryKey: ['workflow-runs', { taskId: task.id }],
    queryFn: () => listWorkflowRuns({ taskId: task.id, limit: 25 }),
    initialData: task.workflow_runs,
    refetchInterval: 10_000,
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

  function selectWorkflow(entry: WorkflowListEntry): void {
    setSelectedWorkflow(entry.workflow.name);
    setWorkflowSearch(entry.workflow.name);
    setWorkflowPickerOpen(false);
  }

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkflow || !message.trim()) return;
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
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs', { taskId: task.id }] });
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
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
        <div className="divide-y divide-border">
          {runs && runs.length > 0 ? (
            runs.map(run => (
              <Link
                key={run.id}
                to={`/workflows/runs/${run.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 text-sm hover:text-primary"
              >
                <span className="truncate text-text-primary">{run.workflow_name}</span>
                <span
                  className={cn('rounded-full px-2 py-0.5 text-[10px]', statusClass(run.status))}
                >
                  {run.status}
                </span>
                <span className="text-xs text-text-tertiary">{formatStartedAt(run)}</span>
              </Link>
            ))
          ) : (
            <p className="py-3 text-sm text-text-tertiary">No workflows have run for this task.</p>
          )}
        </div>
      </div>
    </section>
  );
}

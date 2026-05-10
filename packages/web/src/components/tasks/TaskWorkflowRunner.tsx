import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import {
  createConversation,
  deleteConversation,
  listWorkflowRuns,
  listWorkflows,
  runWorkflow,
} from '@/lib/api';
import type { TaskDetailResponse, WorkflowRunResponse } from '@/lib/api';
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

export function TaskWorkflowRunner({ task, cwd }: TaskWorkflowRunnerProps): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

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
          <select
            value={selectedWorkflow}
            onChange={(e): void => {
              setSelectedWorkflow(e.target.value);
            }}
            className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
          >
            <option value="">Select workflow...</option>
            {sortedWorkflows.map(entry => (
              <option key={`${entry.source}:${entry.workflow.name}`} value={entry.workflow.name}>
                {entry.workflow.name} ({entry.source})
              </option>
            ))}
          </select>
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
            placeholder="Workflow input / arguments"
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

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  createTask,
  deleteTask,
  listTasks,
  listWorkflowRuns,
  getCodebaseEnvironments,
  updateTask,
} from '@/lib/api';
import type { WorkflowRunResponse, IsolationEnvironment } from '@/lib/api';
import { WorkflowInvoker } from '@/components/sidebar/WorkflowInvoker';
import { TaskItem } from '@/components/tasks/TaskItem';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ProjectDetailProps {
  codebaseId: string;
  projectName: string;
  repositoryUrl?: string | null;
  searchQuery: string;
}

function RunStatusBadge({ status }: { status: string }): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        status === 'running' && 'bg-primary/10 text-primary',
        status === 'completed' && 'bg-success/10 text-success',
        status === 'failed' && 'bg-error/10 text-error',
        status === 'cancelled' && 'bg-surface-elevated text-text-secondary'
      )}
    >
      {status}
    </span>
  );
}

export function ProjectDetail({
  codebaseId,
  projectName,
  repositoryUrl,
  searchQuery,
}: ProjectDetailProps): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  const { data: tasks, isError: isErrorTasks } = useQuery({
    queryKey: ['tasks', codebaseId],
    queryFn: () => listTasks({ codebaseId }),
    refetchInterval: 10_000,
  });

  const { data: archivedTasks } = useQuery({
    queryKey: ['tasks', codebaseId, 'archived'],
    queryFn: () => listTasks({ codebaseId, status: 'archived', limit: 100 }),
    refetchInterval: 30_000,
  });

  const { data: runs, isError: isErrorRuns } = useQuery({
    queryKey: ['workflow-runs', { codebaseId }],
    queryFn: () => listWorkflowRuns({ codebaseId, limit: 20 }),
    refetchInterval: 10_000,
  });

  const { data: environments, isError: isErrorEnvironments } = useQuery({
    queryKey: ['environments', { codebaseId }],
    queryFn: () => getCodebaseEnvironments(codebaseId),
    refetchInterval: 10_000,
  });

  const activeEnvironments = useMemo(
    () => environments?.filter((e: IsolationEnvironment) => e.status === 'active') ?? [],
    [environments]
  );

  const handleNewTask = (): void => {
    const title = window.prompt('Task title');
    const trimmed = title?.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed, codebaseId }).then(task => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/chat/tasks/${encodeURIComponent(task.id)}`);
    });
  };

  const handleRunClick = (run: WorkflowRunResponse): void => {
    navigate(`/workflows/runs/${run.id}`);
  };

  const archiveMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (taskId: string) => updateTask(taskId, { status: 'active' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Filter tasks by search
  const filteredTasks = tasks?.filter(task => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.title.toLowerCase().includes(query) ||
      (task.branch_name ?? '').toLowerCase().includes(query) ||
      (task.pr_url ?? '').toLowerCase().includes(query)
    );
  });

  const filteredArchivedTasks = archivedTasks?.filter(task => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.title.toLowerCase().includes(query) ||
      (task.branch_name ?? '').toLowerCase().includes(query) ||
      (task.pr_url ?? '').toLowerCase().includes(query)
    );
  });

  // Filter and sort runs by search and status
  const sortedRuns = runs
    ?.filter(run => {
      if (!searchQuery) return true;
      return run.workflow_name.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      const priority: Record<string, number> = { failed: 0, running: 1, completed: 2 };
      return (priority[a.status] ?? 3) - (priority[b.status] ?? 3);
    });

  return (
    <div className="min-w-0 flex flex-col gap-3">
      <div className="px-1">
        <h3 className="text-sm font-semibold text-text-primary truncate">{projectName}</h3>
        {repositoryUrl && (
          <p className="text-[10px] text-text-tertiary truncate">{repositoryUrl}</p>
        )}
      </div>

      <button
        onClick={handleNewTask}
        className="mx-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-accent-hover transition-colors"
      >
        New Task
      </button>

      <WorkflowInvoker codebaseId={codebaseId} />

      {/* Tasks section */}
      <div>
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          Tasks
        </span>
        <div className="mt-1 flex flex-col gap-0.5">
          {isErrorTasks ? (
            <span className="px-1 text-xs text-error">Failed to load — retrying</span>
          ) : filteredTasks && filteredTasks.length > 0 ? (
            filteredTasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                project={{ id: codebaseId, name: projectName }}
                onArchive={targetTask => {
                  archiveMutation.mutate(targetTask.id);
                }}
              />
            ))
          ) : (
            <span className="px-1 text-xs text-text-tertiary">No tasks</span>
          )}
          {archivedTasks && archivedTasks.length > 0 && (
            <div className="mt-2 border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={(): void => {
                  setShowArchived(prev => !prev);
                }}
                className="flex w-full items-center justify-between rounded px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:bg-surface-elevated"
              >
                <span>Archived</span>
                <span className="inline-flex items-center gap-1">
                  {filteredArchivedTasks?.length ?? 0}
                  {showArchived ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
              {showArchived && (
                <div className="mt-1 flex flex-col gap-0.5 opacity-80">
                  {filteredArchivedTasks && filteredArchivedTasks.length > 0 ? (
                    filteredArchivedTasks.map(task => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        project={{ id: codebaseId, name: projectName }}
                        onRestore={targetTask => {
                          restoreMutation.mutate(targetTask.id);
                        }}
                      />
                    ))
                  ) : (
                    <span className="px-1 text-xs text-text-tertiary">
                      No archived tasks match this search.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Workflow runs section */}
      <div>
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          Workflow Runs
        </span>
        <div className="mt-1 flex flex-col gap-0.5">
          {isErrorRuns ? (
            <span className="px-1 text-xs text-error">Failed to load — retrying</span>
          ) : sortedRuns && sortedRuns.length > 0 ? (
            sortedRuns.map(run => (
              <button
                key={run.id}
                onClick={(): void => {
                  handleRunClick(run);
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-elevated transition-colors w-full text-left"
              >
                <span className="truncate flex-1 text-text-primary">{run.workflow_name}</span>
                <RunStatusBadge status={run.status} />
                <span className="text-text-tertiary shrink-0">
                  {formatDuration(run.started_at, run.completed_at)}
                </span>
              </button>
            ))
          ) : (
            <span className="px-1 text-xs text-text-tertiary">No workflow runs</span>
          )}
        </div>
      </div>

      {/* Active worktrees section */}
      {(isErrorEnvironments || activeEnvironments.length > 0) && (
        <div>
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            Active Worktrees{!isErrorEnvironments && ` (${String(activeEnvironments.length)})`}
          </span>
          <div className="mt-1 flex flex-col gap-0.5">
            {isErrorEnvironments ? (
              <span className="px-1 text-xs text-error">Failed to load — retrying</span>
            ) : (
              activeEnvironments.map((env: IsolationEnvironment) => (
                <div
                  key={env.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs"
                >
                  <span className="truncate font-mono text-[11px] text-text-primary">
                    {env.branch_name}
                  </span>
                  <span className="shrink-0 text-[10px] text-text-tertiary">
                    {env.days_since_activity === 0
                      ? 'today'
                      : `${String(env.days_since_activity)}d ago`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

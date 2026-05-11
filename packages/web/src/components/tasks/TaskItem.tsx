import { Link, useMatch } from 'react-router';
import { Archive, ArchiveRestore, GitBranch, MessageSquare } from 'lucide-react';
import type { TaskResponse, WorkflowRunStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TaskItemProps {
  task: TaskResponse;
  project?: { id: string; name: string };
  onArchive?: (task: TaskResponse) => void;
  onRestore?: (task: TaskResponse) => void;
}

function statusLabel(status: WorkflowRunStatus | null): string {
  if (!status) return 'Idle';
  return status[0].toUpperCase() + status.slice(1);
}

function formatLastActivity(value: string | null): string {
  if (!value) return 'No activity';
  return new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TaskItem({
  task,
  project,
  onArchive,
  onRestore,
}: TaskItemProps): React.ReactElement {
  const activeTaskMatch = useMatch(`/chat/tasks/${task.id}`);
  const activeTaskDescendantMatch = useMatch(`/chat/tasks/${task.id}/*`);
  const isActive = Boolean(activeTaskMatch ?? activeTaskDescendantMatch);
  const action = task.status === 'archived' ? onRestore : onArchive;

  return (
    <div
      className={cn(
        'group relative rounded-lg transition-colors',
        isActive ? 'border-l-2 border-l-primary bg-accent-muted' : 'hover:bg-surface-elevated'
      )}
    >
      <Link
        to={`/chat/tasks/${encodeURIComponent(task.id)}`}
        className="flex min-h-[4.25rem] w-full flex-col gap-1 px-3 py-2 pr-9"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              task.latest_run_status === 'running' && 'animate-pulse bg-primary',
              task.latest_run_status === 'completed' && 'bg-success',
              task.latest_run_status === 'failed' && 'bg-destructive',
              (task.latest_run_status === 'pending' ||
                task.latest_run_status === 'paused' ||
                task.latest_run_status === 'blocked') &&
                'bg-warning',
              (!task.latest_run_status || task.latest_run_status === 'cancelled') &&
                'bg-text-tertiary'
            )}
          />
          <span className="truncate text-sm font-medium text-text-primary" title={task.title}>
            {task.title}
          </span>
          {task.status === 'archived' && (
            <Archive className="h-3 w-3 shrink-0 text-text-tertiary" />
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2 pl-4 text-[10px] text-text-tertiary">
          {project && <span className="truncate">{project.name}</span>}
          {task.branch_name && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{task.branch_name}</span>
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pl-4">
          <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-text-tertiary">
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span>{task.conversation_count}</span>
            <span className="truncate">- {formatLastActivity(task.last_activity_at)}</span>
          </span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
              task.latest_run_status === 'running' && 'bg-primary/15 text-primary',
              task.latest_run_status === 'completed' && 'bg-success/15 text-success',
              task.latest_run_status === 'failed' && 'bg-destructive/15 text-destructive',
              (task.latest_run_status === 'pending' ||
                task.latest_run_status === 'paused' ||
                task.latest_run_status === 'blocked') &&
                'bg-warning/15 text-warning',
              (!task.latest_run_status || task.latest_run_status === 'cancelled') &&
                'bg-surface-secondary text-text-tertiary'
            )}
          >
            {statusLabel(task.latest_run_status)}
          </span>
        </div>
      </Link>
      {action && (
        <button
          type="button"
          onClick={(e): void => {
            e.preventDefault();
            e.stopPropagation();
            action(task);
          }}
          className="absolute right-2 top-2 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-surface-secondary hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
          title={task.status === 'archived' ? 'Restore task' : 'Archive task'}
        >
          {task.status === 'archived' ? (
            <ArchiveRestore className="h-3.5 w-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

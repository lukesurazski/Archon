import { useEffect, useState } from 'react';
import { ExternalLink, GitBranch, Loader2, Save } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskDetailResponse } from '@/lib/api';
import { updateTask } from '@/lib/api';

interface TaskHeaderProps {
  task: TaskDetailResponse;
}

function formatLastActivity(value: string | null): string {
  if (!value) return 'No activity yet';
  return new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TaskHeader({ task }: TaskHeaderProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [branchName, setBranchName] = useState(task.branch_name ?? '');
  const [prUrl, setPrUrl] = useState(task.pr_url ?? '');
  const [description, setDescription] = useState(task.description ?? '');

  useEffect(() => {
    setTitle(task.title);
    setBranchName(task.branch_name ?? '');
    setPrUrl(task.pr_url ?? '');
    setDescription(task.description ?? '');
  }, [task.id, task.title, task.branch_name, task.pr_url, task.description]);

  const mutation = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        title: title.trim(),
        branchName: branchName.trim() || null,
        prUrl: prUrl.trim() || null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const changed =
    title !== task.title ||
    branchName !== (task.branch_name ?? '') ||
    prUrl !== (task.pr_url ?? '') ||
    description !== (task.description ?? '');

  return (
    <div className="border-b border-border bg-surface px-6 py-5">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e): void => {
                setTitle(e.target.value);
              }}
              className="w-full bg-transparent text-2xl font-semibold text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder="Task title"
            />
            <textarea
              value={description}
              onChange={(e): void => {
                setDescription(e.target.value);
              }}
              rows={2}
              className="mt-2 w-full resize-none bg-transparent text-sm text-text-secondary outline-none placeholder:text-text-tertiary"
              placeholder="Add a short task description..."
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Last activity: {formatLastActivity(task.last_activity_at)}
            </p>
          </div>
          <button
            onClick={(): void => {
              mutation.mutate();
            }}
            disabled={!changed || !title.trim() || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2">
            <GitBranch className="h-4 w-4 text-text-tertiary" />
            <input
              value={branchName}
              onChange={(e): void => {
                setBranchName(e.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder="Branch name"
            />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2">
            <ExternalLink className="h-4 w-4 text-text-tertiary" />
            <input
              value={prUrl}
              onChange={(e): void => {
                setPrUrl(e.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder="PR URL"
            />
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-primary hover:underline"
              >
                Open
              </a>
            )}
          </label>
        </div>

        {mutation.isError && (
          <p className="text-xs text-error">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to update task'}
          </p>
        )}
      </div>
    </div>
  );
}

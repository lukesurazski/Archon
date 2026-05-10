import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FolderGit2 } from 'lucide-react';
import { deleteTask, updateTask } from '@/lib/api';
import type { TaskResponse } from '@/lib/api';
import { TaskItem } from '@/components/tasks/TaskItem';

interface TasksViewProps {
  tasks?: TaskResponse[];
  archivedTasks?: TaskResponse[];
  searchQuery: string;
  isError?: boolean;
  getProject?: (task: TaskResponse) => { id: string; name: string } | undefined;
  onArchivedTask?: (taskId: string) => void;
  compact?: boolean;
}

function matchesTask(task: TaskResponse, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return (
    task.title.toLowerCase().includes(normalized) ||
    (task.branch_name ?? '').toLowerCase().includes(normalized) ||
    (task.pr_url ?? '').toLowerCase().includes(normalized)
  );
}

export function TasksView({
  tasks,
  archivedTasks,
  searchQuery,
  isError,
  getProject,
  onArchivedTask,
  compact = false,
}: TasksViewProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  const filteredTasks = useMemo(
    () => tasks?.filter(task => matchesTask(task, searchQuery)),
    [tasks, searchQuery]
  );
  const filteredArchivedTasks = useMemo(
    () => archivedTasks?.filter(task => matchesTask(task, searchQuery)),
    [archivedTasks, searchQuery]
  );

  const archiveMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: (_result, taskId) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      onArchivedTask?.(taskId);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (taskId: string) => updateTask(taskId, { status: 'active' }),
    onSuccess: (_result, taskId) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });

  return (
    <div>
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        Tasks
      </span>
      <div className="mt-1 flex flex-col gap-0.5">
        {isError ? (
          <span className="px-1 text-xs text-error">Failed to load - retrying</span>
        ) : filteredTasks && filteredTasks.length > 0 ? (
          filteredTasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              project={getProject?.(task)}
              onArchive={targetTask => {
                archiveMutation.mutate(targetTask.id);
              }}
            />
          ))
        ) : compact ? (
          <span className="px-1 text-xs text-text-tertiary">
            {tasks && tasks.length > 0 ? 'No matching tasks' : 'No tasks'}
          </span>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
            <FolderGit2 className="h-8 w-8 text-text-tertiary" />
            <span className="text-center text-xs text-text-tertiary">
              {tasks && tasks.length > 0 ? 'No matching tasks' : 'No tasks yet - create one.'}
            </span>
          </div>
        )}

        {archivedTasks && archivedTasks.length > 0 && (
          <div className="mt-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={(): void => {
                setShowArchived(prev => !prev);
              }}
              className="flex w-full items-center justify-between rounded px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:bg-surface-elevated hover:text-text-secondary"
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
                      project={getProject?.(task)}
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
  );
}

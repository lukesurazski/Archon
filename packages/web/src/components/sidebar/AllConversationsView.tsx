import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createTask, deleteTask, listTasks, updateTask } from '@/lib/api';
import type { CodebaseResponse } from '@/lib/api';
import { TaskItem } from '@/components/tasks/TaskItem';
import { useProject } from '@/contexts/ProjectContext';

interface AllConversationsViewProps {
  searchQuery: string;
}

export function AllConversationsView({
  searchQuery,
}: AllConversationsViewProps): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { codebases } = useProject();
  const [showArchived, setShowArchived] = useState(false);

  const { data: tasks, isError: isErrorTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
    refetchInterval: 10_000,
  });

  const { data: archivedTasks } = useQuery({
    queryKey: ['tasks', 'archived'],
    queryFn: () => listTasks({ status: 'archived', limit: 100 }),
    refetchInterval: 30_000,
  });

  const codebaseMap = new Map<string, CodebaseResponse>();
  if (codebases) {
    for (const cb of codebases) {
      codebaseMap.set(cb.id, cb);
    }
  }

  const handleNewTask = (): void => {
    const title = window.prompt('Task title');
    const trimmed = title?.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed }).then(task => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/chat/tasks/${encodeURIComponent(task.id)}`);
    });
  };

  const filtered = tasks?.filter(task => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.title.toLowerCase().includes(query) ||
      (task.branch_name ?? '').toLowerCase().includes(query) ||
      (task.pr_url ?? '').toLowerCase().includes(query)
    );
  });

  const filteredArchived = archivedTasks?.filter(task => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.title.toLowerCase().includes(query) ||
      (task.branch_name ?? '').toLowerCase().includes(query) ||
      (task.pr_url ?? '').toLowerCase().includes(query)
    );
  });

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

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={handleNewTask}
        className="mx-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-accent-hover transition-colors"
      >
        New Task
      </button>

      <div>
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          Tasks
        </span>
        <div className="mt-1 flex flex-col gap-0.5">
          {isErrorTasks ? (
            <span className="px-1 text-xs text-error">Failed to load — retrying</span>
          ) : filtered && filtered.length > 0 ? (
            filtered.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                project={task.codebase_id ? codebaseMap.get(task.codebase_id) : undefined}
                onArchive={targetTask => {
                  archiveMutation.mutate(targetTask.id);
                }}
              />
            ))
          ) : (
            <span className="px-1 text-xs text-text-tertiary">
              {tasks && tasks.length > 0 ? 'No matching tasks' : 'No tasks yet — create one.'}
            </span>
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
                  {filteredArchived?.length ?? 0}
                  {showArchived ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
              {showArchived && (
                <div className="mt-1 flex flex-col gap-0.5 opacity-80">
                  {filteredArchived && filteredArchived.length > 0 ? (
                    filteredArchived.map(task => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        project={task.codebase_id ? codebaseMap.get(task.codebase_id) : undefined}
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
    </div>
  );
}

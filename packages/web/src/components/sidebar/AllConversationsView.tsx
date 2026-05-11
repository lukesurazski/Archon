import { useQuery } from '@tanstack/react-query';
import { listTasks } from '@/lib/api';
import type { CodebaseResponse } from '@/lib/api';
import { TasksView } from '@/components/sidebar/TasksView';
import { useProject } from '@/contexts/ProjectContext';
import { useCreateTaskFlow } from '@/hooks/useCreateTaskFlow';

interface AllConversationsViewProps {
  searchQuery: string;
}

export function AllConversationsView({
  searchQuery,
}: AllConversationsViewProps): React.ReactElement {
  const { codebases } = useProject();
  const createTaskFlow = useCreateTaskFlow();

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
    createTaskFlow().catch((err: unknown) => {
      console.warn('[AllConversationsView] createTask failed', err);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={handleNewTask}
        className="mx-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-accent-hover transition-colors"
      >
        New Task
      </button>

      <TasksView
        tasks={tasks}
        archivedTasks={archivedTasks}
        searchQuery={searchQuery}
        isError={isErrorTasks}
        getProject={task => (task.codebase_id ? codebaseMap.get(task.codebase_id) : undefined)}
        compact
      />
    </div>
  );
}

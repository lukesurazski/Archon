import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronLeft, MessageSquarePlus, Search, Plus, Loader2 } from 'lucide-react';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { TaskConversationList } from '@/components/tasks/TaskConversationList';
import { TaskHeader } from '@/components/tasks/TaskHeader';
import { TaskWorkflowRunner } from '@/components/tasks/TaskWorkflowRunner';
import { TasksView } from '@/components/sidebar/TasksView';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useProject } from '@/contexts/ProjectContext';
import {
  addCodebase,
  createConversation,
  deleteTask,
  getCodebaseInput,
  getTask,
  listTasks,
} from '@/lib/api';
import { useCreateTaskFlow } from '@/hooks/useCreateTaskFlow';
import type { CodebaseResponse } from '@/lib/api';

const PANEL_MIN = 220;
const PANEL_MAX = 420;
const PANEL_DEFAULT = 260;
const STORAGE_KEY = 'archon-chat-panel-width';

function parseWorkspacePath(rawPath: string | undefined): {
  taskId?: string;
  conversationId?: string;
} {
  if (!rawPath) return {};

  const parts = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'tasks' && parts[1]) {
    return {
      taskId: parts[1],
      conversationId: parts[2] === 'chats' ? parts[3] : undefined,
    };
  }

  return { conversationId: decodeURIComponent(rawPath) };
}

function getInitialWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = Number(stored);
    if (parsed >= PANEL_MIN && parsed <= PANEL_MAX) return parsed;
  }
  return PANEL_DEFAULT;
}

export function ChatPage(): React.ReactElement {
  const { '*': rawWorkspacePath } = useParams();
  const { taskId, conversationId } = parseWorkspacePath(rawWorkspacePath);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedProjectId, setSelectedProjectId, codebases, isLoadingCodebases } = useProject();

  const [searchQuery, setSearchQuery] = useState('');
  const [width, setWidth] = useState(getInitialWidth);
  const isResizing = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Add-project state
  const [showAddInput, setShowAddInput] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Single banner shared by createTask / new-chat / archive errors. These
  // are related user actions and one error slot keeps the UI quiet
  // (last writer wins). createTask usually navigates away on success, so
  // the slot is rarely contested; new-chat + archive are bound to the same
  // page but the simultaneous-flight case is benign — the surviving error
  // is whichever finished most recently.
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const createTaskFlow = useCreateTaskFlow();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  useEffect(() => {
    if (showAddInput) {
      addInputRef.current?.focus();
    }
  }, [showAddInput]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = width;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (moveEvent: MouseEvent): void => {
        const newWidth = Math.min(
          PANEL_MAX,
          Math.max(PANEL_MIN, startWidth + moveEvent.clientX - startX)
        );
        setWidth(newWidth);
      };

      const onMouseUp = (): void => {
        isResizing.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width]
  );

  const { data: tasks } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => listTasks({ codebaseId: selectedProjectId ?? undefined }),
    refetchInterval: 10_000,
  });

  const { data: archivedTasks } = useQuery({
    queryKey: ['tasks', selectedProjectId, 'archived'],
    queryFn: () =>
      listTasks({
        codebaseId: selectedProjectId ?? undefined,
        status: 'archived',
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  const { data: selectedTask, isLoading: isLoadingTask } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId ?? ''),
    enabled: Boolean(taskId),
    refetchInterval: 10_000,
  });

  const codebaseMap = useMemo((): Map<string, CodebaseResponse> => {
    const map = new Map<string, CodebaseResponse>();
    if (codebases) {
      for (const cb of codebases) {
        map.set(cb.id, cb);
      }
    }
    return map;
  }, [codebases]);

  const handleNewTask = useCallback((): void => {
    setTaskActionError(null);
    createTaskFlow({ codebaseId: selectedProjectId ?? undefined }).catch((err: unknown) => {
      setTaskActionError(err instanceof Error ? err.message : 'Failed to create task');
    });
  }, [createTaskFlow, selectedProjectId]);

  const newChatMutation = useMutation({
    mutationFn: () =>
      createConversation(selectedTask?.codebase_id ?? undefined, undefined, selectedTask?.id),
    onSuccess: result => {
      if (!selectedTask) return;
      void queryClient.invalidateQueries({ queryKey: ['task', selectedTask.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate(
        `/chat/tasks/${encodeURIComponent(selectedTask.id)}/chats/${encodeURIComponent(result.conversationId)}`
      );
    },
    onError: err => {
      setTaskActionError(err instanceof Error ? err.message : 'Failed to start chat');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => {
      if (!taskId) throw new Error('No task selected');
      return deleteTask(taskId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate('/chat');
    },
    onError: err => {
      setTaskActionError(err instanceof Error ? err.message : 'Failed to archive task');
    },
  });

  const handleAddSubmit = useCallback((): void => {
    const trimmed = addValue.trim();
    if (!trimmed || addLoading) return;

    setAddLoading(true);
    setAddError(null);

    void addCodebase(getCodebaseInput(trimmed))
      .then(codebase => {
        void queryClient.invalidateQueries({ queryKey: ['codebases'] });
        setSelectedProjectId(codebase.id);
        setShowAddInput(false);
        setAddValue('');
        setAddError(null);
      })
      .catch((err: Error) => {
        setAddError(err.message);
      })
      .finally(() => {
        setAddLoading(false);
      });
  }, [addValue, addLoading, queryClient, setSelectedProjectId]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        handleAddSubmit();
      } else if (e.key === 'Escape') {
        setShowAddInput(false);
        setAddValue('');
        setAddError(null);
      }
    },
    [handleAddSubmit]
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div
        className="relative flex h-full flex-col border-r border-border bg-surface overflow-hidden"
        style={{ width: `${String(width)}px`, flexShrink: 0 }}
      >
        {/* New Task button */}
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={handleNewTask}
            className="flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            New Task
          </button>
          {taskActionError && (
            <div className="mt-2 rounded-md border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
              {taskActionError}
            </div>
          )}
        </div>

        {/* Project filter */}
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              Project
            </span>
            <button
              onClick={(): void => {
                setShowAddInput(prev => !prev);
                setAddError(null);
                setAddValue('');
              }}
              className="p-1 rounded hover:bg-surface-elevated transition-colors"
              title="Add project"
            >
              <Plus className="h-3.5 w-3.5 text-text-tertiary hover:text-primary" />
            </button>
          </div>

          {showAddInput && (
            <div className="mb-2">
              <div className="flex items-center gap-1">
                <input
                  ref={addInputRef}
                  value={addValue}
                  onChange={(e): void => {
                    setAddValue(e.target.value);
                  }}
                  onKeyDown={handleAddKeyDown}
                  onBlur={(): void => {
                    if (!addValue.trim() && !addError) {
                      setShowAddInput(false);
                    }
                  }}
                  placeholder="GitHub URL or local path"
                  disabled={addLoading}
                  className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none disabled:opacity-50"
                />
                {addLoading && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                )}
              </div>
              {addError && <p className="mt-1 text-[10px] text-error line-clamp-2">{addError}</p>}
            </div>
          )}

          {isLoadingCodebases ? (
            <div className="flex items-center justify-center py-2">
              <span className="text-xs text-text-tertiary">Loading...</span>
            </div>
          ) : (
            <select
              value={selectedProjectId ?? ''}
              onChange={(e): void => {
                setSelectedProjectId(e.target.value || null);
              }}
              className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="">All Projects</option>
              {codebases?.map(cb => (
                <option key={cb.id} value={cb.id}>
                  {cb.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <Separator className="bg-border" />

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e): void => {
                setSearchQuery(e.target.value);
              }}
              placeholder="Search..."
              className="w-full rounded-md border border-border bg-surface-elevated py-1.5 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Task list */}
        <ScrollArea className="flex-1 min-h-0 px-2 pb-2">
          <TasksView
            tasks={tasks}
            archivedTasks={archivedTasks}
            searchQuery={searchQuery}
            getProject={task => (task.codebase_id ? codebaseMap.get(task.codebase_id) : undefined)}
            onArchivedTask={archivedTaskId => {
              if (archivedTaskId === taskId) navigate('/chat');
            }}
          />
        </ScrollArea>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-border/50 hover:bg-primary/40 transition-colors"
        />
      </div>

      {/* Right panel - task workspace or legacy direct chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {taskId ? (
          isLoadingTask ? (
            <div className="flex flex-1 items-center justify-center text-text-tertiary">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading task...
            </div>
          ) : selectedTask ? (
            conversationId ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
                  <Link
                    to={`/chat/tasks/${encodeURIComponent(selectedTask.id)}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-primary"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {selectedTask.title}
                  </Link>
                  <span className="text-xs text-text-tertiary">Chat thread</span>
                </div>
                <ChatInterface key={conversationId} conversationId={conversationId} />
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <TaskHeader task={selectedTask} />
                <div className="flex-1 overflow-auto p-6">
                  <div className="mx-auto flex max-w-6xl flex-col gap-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-text-tertiary">
                        {selectedTask.codebase_id
                          ? (codebaseMap.get(selectedTask.codebase_id)?.name ?? 'Unknown project')
                          : 'No project'}{' '}
                        · {selectedTask.conversation_count} chat
                        {selectedTask.conversation_count === 1 ? '' : 's'}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(): void => {
                            newChatMutation.mutate();
                          }}
                          disabled={newChatMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
                        >
                          {newChatMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MessageSquarePlus className="h-4 w-4" />
                          )}
                          New Chat
                        </button>
                        <button
                          onClick={(): void => {
                            archiveMutation.mutate();
                          }}
                          disabled={archiveMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-50"
                        >
                          {archiveMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Archive className="h-4 w-4" />
                          )}
                          Archive
                        </button>
                      </div>
                    </div>

                    <TaskWorkflowRunner
                      task={selectedTask}
                      cwd={
                        selectedTask.codebase_id
                          ? codebaseMap.get(selectedTask.codebase_id)?.default_cwd
                          : undefined
                      }
                    />
                    <TaskConversationList
                      taskId={selectedTask.id}
                      conversations={selectedTask.conversations}
                    />
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-tertiary">
              <p>Task not found.</p>
              <Link to="/chat" className="text-sm font-medium text-primary hover:underline">
                Back to tasks
              </Link>
            </div>
          )
        ) : (
          <ChatInterface key={conversationId ?? 'new'} conversationId={conversationId ?? 'new'} />
        )}
      </div>
    </div>
  );
}

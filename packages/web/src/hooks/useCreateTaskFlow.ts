import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createTask, type TaskResponse } from '@/lib/api';

interface CreateTaskDefaults {
  codebaseId?: string;
  description?: string;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
}

/**
 * Encapsulates the "prompt for title → createTask → invalidate ['tasks'] →
 * navigate to /chat/tasks/<id>" sequence that previously appeared three
 * times across the sidebar/main view. Rule-of-Three extract — keeps the
 * cache-invalidation key, the URL shape, and the error-propagation contract
 * in one place so future drift can't slip past.
 *
 * Returns a function that prompts for a title, dispatches createTask, and
 * resolves with the new task (so callers may attach extra `.then` handlers).
 * Errors are re-thrown — callers should attach `.catch` to surface a banner.
 */
export function useCreateTaskFlow(): (
  defaults?: CreateTaskDefaults
) => Promise<TaskResponse | null> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useCallback(
    async (defaults?: CreateTaskDefaults) => {
      const title = window.prompt('Task title');
      const trimmed = title?.trim();
      if (!trimmed) return null;
      const task = await createTask({ title: trimmed, ...(defaults ?? {}) });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/chat/tasks/${encodeURIComponent(task.id)}`);
      return task;
    },
    [navigate, queryClient]
  );
}

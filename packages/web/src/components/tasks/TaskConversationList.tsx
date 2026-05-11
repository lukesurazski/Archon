import { Link } from 'react-router';
import { MessageSquare } from 'lucide-react';
import type { ConversationResponse } from '@/lib/api';

interface TaskConversationListProps {
  taskId: string;
  conversations: ConversationResponse[];
}

function formatTime(value: string | null): string {
  if (!value) return 'No activity';
  return new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TaskConversationList({
  taskId,
  conversations,
}: TaskConversationListProps): React.ReactElement {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Chats</h2>
        <span className="text-xs text-text-tertiary">{conversations.length}</span>
      </div>
      <div className="divide-y divide-border">
        {conversations.length > 0 ? (
          conversations.map(conversation => (
            <Link
              key={conversation.id}
              to={`/chat/tasks/${encodeURIComponent(taskId)}/chats/${encodeURIComponent(conversation.platform_conversation_id)}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-elevated"
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">
                  {conversation.title ?? 'Untitled conversation'}
                </p>
                <p className="truncate text-xs text-text-tertiary">
                  {formatTime(conversation.last_activity_at)}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <p className="px-4 py-6 text-sm text-text-tertiary">No chats in this task yet.</p>
        )}
      </div>
    </section>
  );
}

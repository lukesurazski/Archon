import { Navigate, useParams } from 'react-router';

export function TaskPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();

  return <Navigate to={id ? `/chat/tasks/${encodeURIComponent(id)}` : '/chat'} replace />;
}

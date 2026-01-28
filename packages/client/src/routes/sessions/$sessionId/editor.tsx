import { createFileRoute } from '@tanstack/react-router';
import { SessionEditor } from '@/components/session/session-editor';

export const Route = createFileRoute('/sessions/$sessionId/editor')({
  component: SessionEditorPage,
});

function SessionEditorPage() {
  const { sessionId } = Route.useParams();

  return <SessionEditor sessionId={sessionId} />;
}

import { createFileRoute } from '@tanstack/react-router';
import { ChatContainer } from '@/components/chat/chat-container';

export const Route = createFileRoute('/sessions/$sessionId/')({
  component: SessionChatPage,
});

function SessionChatPage() {
  const { sessionId } = Route.useParams();

  return <ChatContainer sessionId={sessionId} />;
}

import { createFileRoute } from '@tanstack/react-router';
import { ChatContainer } from '@/components/chat/chat-container';

type SessionSearchParams = {
  threadId?: string;
  continuationContext?: string;
};

export const Route = createFileRoute('/sessions/$sessionId/')({
  component: SessionChatPage,
  validateSearch: (search: Record<string, unknown>): SessionSearchParams => ({
    threadId: typeof search.threadId === 'string' ? search.threadId : undefined,
    continuationContext: typeof search.continuationContext === 'string' ? search.continuationContext : undefined,
  }),
});

function SessionChatPage() {
  const { sessionId } = Route.useParams();
  const { threadId, continuationContext } = Route.useSearch();

  return (
    <ChatContainer
      sessionId={sessionId}
      initialThreadId={threadId}
      initialContinuationContext={continuationContext}
    />
  );
}

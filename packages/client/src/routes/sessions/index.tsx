import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { SessionList } from '@/components/sessions/session-list';
import { CreateSessionDialog } from '@/components/sessions/create-session-dialog';

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
});

function SessionsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Sessions"
        description="Manage your AI agent sessions"
        actions={<CreateSessionDialog />}
      />
      <SessionList />
    </PageContainer>
  );
}

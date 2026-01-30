import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { SessionTable } from '@/components/sessions/session-table';
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
      <SessionTable />
    </PageContainer>
  );
}

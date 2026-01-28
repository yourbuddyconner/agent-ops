import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { WorkflowList } from '@/components/workflows/workflow-list';

export const Route = createFileRoute('/workflows/')({
  component: WorkflowsPage,
});

function WorkflowsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description="Manage your automated workflows and triggers"
      />
      <WorkflowList />
    </PageContainer>
  );
}

import { createFileRoute } from '@tanstack/react-router';
import { WorkflowList } from '@/components/workflows/workflow-list';

export const Route = createFileRoute('/automation/workflows/')({
  component: WorkflowsPage,
});

function WorkflowsPage() {
  return <WorkflowList />;
}

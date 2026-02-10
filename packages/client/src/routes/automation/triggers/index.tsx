import { createFileRoute } from '@tanstack/react-router';
import { TriggerList } from '@/components/automation/trigger-list';

export const Route = createFileRoute('/automation/triggers/')({
  component: TriggersPage,
});

function TriggersPage() {
  return <TriggerList />;
}

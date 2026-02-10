import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/workflows/executions')({
  beforeLoad: () => {
    throw redirect({ to: '/automation/executions' });
  },
});

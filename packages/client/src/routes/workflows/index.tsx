import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/workflows/')({
  beforeLoad: () => {
    throw redirect({ to: '/automation/workflows' });
  },
});

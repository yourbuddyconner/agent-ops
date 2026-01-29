import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/sessions/$sessionId')({
  component: () => <Outlet />,
});

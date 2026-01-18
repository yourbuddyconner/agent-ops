import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginForm } from '@/components/auth/login-form';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) {
      throw redirect({ to: '/' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 p-4">
      <LoginForm />
    </div>
  );
}

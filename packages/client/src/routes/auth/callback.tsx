import * as React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/client';

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('No token received from OAuth provider.');
      return;
    }

    // Temporarily set the token so api client can use it
    useAuthStore.setState({ token });

    api
      .get<{ user: { id: string; email: string; name?: string; avatarUrl?: string } }>('/auth/me')
      .then((res) => {
        setAuth(token, {
          id: res.user.id,
          email: res.user.email,
          name: res.user.name,
          avatarUrl: res.user.avatarUrl,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        navigate({ to: '/' });
      })
      .catch(() => {
        useAuthStore.getState().clearAuth();
        navigate({ to: '/login', search: { error: 'validation_failed' } });
      });
  }, [navigate, setAuth]);

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 p-4">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <a href="/login" className="text-sm text-neutral-500 underline mt-2 inline-block">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 p-4">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-2 border-neutral-300 border-t-neutral-900 rounded-full mx-auto mb-4" />
        <p className="text-sm text-neutral-600">Completing sign in...</p>
      </div>
    </div>
  );
}

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useValidateToken } from '@/api/auth';
import { ApiError } from '@/api/client';

export function LoginForm() {
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const validateToken = useValidateToken();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Please enter an API token');
      return;
    }

    validateToken.mutate(token.trim(), {
      onError: (err) => {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setError('Invalid API token. Please check and try again.');
          } else {
            setError(err.message || 'Failed to validate token');
          }
        } else {
          setError('An unexpected error occurred');
        }
      },
    });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-900">
          <svg
            className="h-6 w-6 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <CardTitle className="text-2xl">Agent Ops</CardTitle>
        <CardDescription>
          Enter your API token to continue
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="token" className="text-sm font-medium text-neutral-700">
              API Token
            </label>
            <Input
              id="token"
              type="password"
              placeholder="sk_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={validateToken.isPending}
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={validateToken.isPending}
          >
            {validateToken.isPending ? 'Validating...' : 'Sign in'}
          </Button>
          <p className="text-center text-xs text-neutral-500">
            Get your API token from the Settings page after signing in
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

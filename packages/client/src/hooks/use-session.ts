import { useSession as useSessionQuery } from '@/api/sessions';

export function useSession(sessionId: string) {
  const { data: session, isLoading, error } = useSessionQuery(sessionId);

  return {
    session,
    isLoading,
    error,
    isIdle: session?.status === 'idle',
    isRunning: session?.status === 'running',
    isTerminated: session?.status === 'terminated',
    isError: session?.status === 'error',
  };
}

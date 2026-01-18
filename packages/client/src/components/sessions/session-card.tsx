import { Link } from '@tanstack/react-router';
import type { AgentSession } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';

interface SessionCardProps {
  session: AgentSession;
}

export function SessionCard({ session }: SessionCardProps) {
  return (
    <Link to="/sessions/$sessionId" params={{ sessionId: session.id }}>
      <Card className="transition-colors hover:border-neutral-300">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">{session.workspace}</CardTitle>
            <StatusBadge status={session.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm text-neutral-500">
            <span className="truncate">ID: {session.id.slice(0, 8)}...</span>
            <span className="tabular-nums">
              {formatRelativeTime(session.lastActiveAt)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusBadge({ status }: { status: AgentSession['status'] }) {
  const variants: Record<
    AgentSession['status'],
    'default' | 'success' | 'warning' | 'error' | 'secondary'
  > = {
    initializing: 'warning',
    running: 'success',
    idle: 'default',
    terminated: 'secondary',
    error: 'error',
  };

  return <Badge variant={variants[status]}>{status}</Badge>;
}

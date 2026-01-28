import { cn } from '@/lib/cn';

interface CollaboratorsBarProps {
  connectedUsers: ConnectedUser[];
  className?: string;
}

export interface ConnectedUser {
  id: string;
  name?: string;
  avatarUrl?: string;
}

const COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-red-500',
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getInitials(name?: string, id?: string): string {
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return (id ?? '??').slice(0, 2).toUpperCase();
}

export function CollaboratorsBar({ connectedUsers, className }: CollaboratorsBarProps) {
  if (connectedUsers.length === 0) return null;

  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {connectedUsers.map((user) => (
        <div key={user.id} className="group relative">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name || user.id}
              className="h-7 w-7 rounded-full border-2 border-white ring-0 dark:border-neutral-800"
            />
          ) : (
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-medium text-white dark:border-neutral-800',
                getColorForUser(user.id)
              )}
            >
              {getInitials(user.name, user.id)}
            </div>
          )}
          {/* Tooltip */}
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-neutral-700">
            {user.name || `User ${user.id.slice(0, 8)}`}
          </div>
        </div>
      ))}
      {connectedUsers.length > 1 && (
        <span className="pl-3 text-xs text-neutral-500 dark:text-neutral-400">
          {connectedUsers.length} online
        </span>
      )}
    </div>
  );
}

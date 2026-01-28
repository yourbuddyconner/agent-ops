import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

  const handleSignOut = () => {
    clearAuth();
    navigate({ to: '/login' });
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <header className="flex h-12 items-center justify-between border-b border-neutral-200 bg-surface-0 px-4 dark:border-neutral-800 dark:bg-surface-0">
      <div />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded-full ring-offset-surface-0 focus:outline-none focus:ring-2 focus:ring-accent/40">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.name ?? 'User'} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-[13px] font-medium text-neutral-900 text-pretty dark:text-neutral-100">
              {user?.name ?? 'User'}
            </p>
            <p className="font-mono text-[11px] text-neutral-500 truncate dark:text-neutral-400">{user?.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOut} className="text-[13px]">
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

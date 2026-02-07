import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MobileNavMenu } from './mobile-nav-menu';
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
  const { theme, setTheme, isDark } = useTheme();

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
      <div className="flex items-center md:hidden">
        <MobileNavMenu />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (theme === 'system') {
              setTheme(isDark ? 'light' : 'dark');
            } else if (theme === 'dark') {
              setTheme('light');
            } else {
              setTheme('dark');
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-surface-2 hover:text-neutral-600 dark:hover:text-neutral-300"
          title={`Theme: ${theme}`}
        >
          {isDark ? (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7.5" cy="7.5" r="3" />
              <path d="M7.5 1.5v1M7.5 12.5v1M1.5 7.5h1M12.5 7.5h1M3.26 3.26l.7.7M11.04 11.04l.7.7M11.04 3.26l-.7.7M3.26 11.04l-.7.7" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8.5a6 6 0 1 1-7-7 4.5 4.5 0 0 0 7 7z" />
            </svg>
          )}
        </button>

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
      </div>
    </header>
  );
}

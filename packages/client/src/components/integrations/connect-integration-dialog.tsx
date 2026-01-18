import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/api/client';

const SERVICES = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues, and pull requests',
    icon: GitHubIcon,
    supportsOAuth: true,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Email messages and labels',
    icon: GmailIcon,
    supportsOAuth: true,
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Events and calendars',
    icon: CalendarIcon,
    supportsOAuth: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Pages and databases',
    icon: NotionIcon,
    supportsOAuth: false,
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Channels and messages',
    icon: DiscordIcon,
    supportsOAuth: false,
  },
] as const;

interface ConnectIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectIntegrationDialog({
  open,
  onOpenChange,
}: ConnectIntegrationDialogProps) {
  const [connecting, setConnecting] = React.useState<string | null>(null);

  const handleConnect = async (serviceId: string) => {
    const service = SERVICES.find((s) => s.id === serviceId);
    if (!service?.supportsOAuth) {
      // For non-OAuth services, we'd show a credential input form
      // For now, just show a message
      alert('This integration requires manual configuration.');
      return;
    }

    setConnecting(serviceId);

    try {
      const redirectUri = `${window.location.origin}/integrations/callback`;
      const response = await api.get<{ url: string; state: string }>(
        `/integrations/${serviceId}/oauth?redirect_uri=${encodeURIComponent(redirectUri)}`
      );

      // Store state in sessionStorage for verification
      sessionStorage.setItem('oauth_state', response.state);
      sessionStorage.setItem('oauth_service', serviceId);

      // Redirect to OAuth provider
      window.location.href = response.url;
    } catch (error) {
      console.error('Failed to initiate OAuth:', error);
      setConnecting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect Integration</DialogTitle>
          <DialogDescription>
            Choose a service to connect with your Agent Ops workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SERVICES.map((service) => (
            <button
              key={service.id}
              onClick={() => handleConnect(service.id)}
              disabled={connecting === service.id}
              className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-left transition-colors hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
                <service.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-neutral-900">{service.name}</p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {service.description}
                </p>
              </div>
              {connecting === service.id && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
              )}
            </button>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-neutral-500">
          You will be redirected to authorize access
        </p>
      </DialogContent>
    </Dialog>
  );
}

// Icons
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GmailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 2.02c-.42-.326-.98-.7-2.055-.607L3.01 2.72c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.233 4.763 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM2.877 1.106l13.542-1.027c1.635-.14 2.055-.047 3.08.7l4.204 2.962c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.13-4.016c-.56-.747-.793-1.306-.793-1.96V2.92c0-.84.373-1.68 1.262-1.773z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

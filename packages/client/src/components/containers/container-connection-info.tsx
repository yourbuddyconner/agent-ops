import { useState } from 'react';
import type { Container } from '@/api/containers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ContainerConnectionInfoProps {
  container: Container;
}

export function ContainerConnectionInfo({ container }: ContainerConnectionInfoProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const proxyUrl = `/api/containers/${container.id}/proxy/`;

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (container.status !== 'running') {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Connection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">
            Start the container to view connection information.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Region */}
        {container.region && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Region</span>
            <span className="text-sm font-medium text-neutral-900">
              {container.region}
            </span>
          </div>
        )}

        {/* Port */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500">Port</span>
          <span className="text-sm font-medium text-neutral-900 font-mono">
            {container.port}
          </span>
        </div>

        {/* Internal IP (if available) */}
        {container.ipAddress && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-neutral-500">Internal IP</span>
            <div className="flex items-center gap-2">
              <code className="text-sm text-neutral-900">
                {container.ipAddress}
              </code>
              <CopyButton
                onClick={() => handleCopy(container.ipAddress!, 'ip')}
                copied={copied === 'ip'}
              />
            </div>
          </div>
        )}

        {/* Proxy URL */}
        <div className="space-y-2">
          <span className="text-sm text-neutral-500">Proxy URL</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-900">
              {proxyUrl}
            </code>
            <CopyButton
              onClick={() => handleCopy(window.location.origin + proxyUrl, 'proxy')}
              copied={copied === 'proxy'}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface CopyButtonProps {
  onClick: () => void;
  copied: boolean;
}

function CopyButton({ onClick, copied }: CopyButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 w-7 p-0"
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? (
        <CheckIcon className="size-4 text-green-600" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </Button>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

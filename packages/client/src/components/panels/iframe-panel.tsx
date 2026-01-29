import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

interface IframePanelProps {
  src: string | undefined;
  token: string | undefined;
  title: string;
  isLoading?: boolean;
  className?: string;
}

/**
 * Base iframe panel with JWT token injection, loading state, and error handling.
 * Token is appended as a query param so the auth gateway can validate it.
 */
export function IframePanel({ src, token, title, isLoading, className }: IframePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Append token as query param, using & if URL already has query params
  const fullUrl = src && token
    ? `${src}${src.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : undefined;

  useEffect(() => {
    setIframeLoaded(false);
  }, [fullUrl]);

  if (isLoading || !fullUrl) {
    return (
      <div className={cn('flex items-center justify-center bg-surface-0 text-neutral-500 dark:bg-surface-0 dark:text-neutral-400', className)}>
        <div className="text-center">
          <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-accent dark:border-neutral-600 dark:border-t-accent" />
          <p className="font-mono text-[11px]">{isLoading ? `Loading ${title}...` : `Waiting for sandbox...`}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative bg-surface-0 dark:bg-surface-0', className)}>
      {!iframeLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-0 text-neutral-500 dark:bg-surface-0 dark:text-neutral-400">
          <div className="text-center">
            <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-accent dark:border-neutral-600 dark:border-t-accent" />
            <p className="font-mono text-[11px]">Loading {title}...</p>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={fullUrl}
        title={title}
        className={cn('h-full w-full border-0', !iframeLoaded && 'invisible')}
        onLoad={() => setIframeLoaded(true)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}

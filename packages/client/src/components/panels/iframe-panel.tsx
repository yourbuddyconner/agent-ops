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

  const fullUrl = src && token ? `${src}?token=${encodeURIComponent(token)}` : undefined;

  useEffect(() => {
    setIframeLoaded(false);
  }, [fullUrl]);

  if (isLoading || !fullUrl) {
    return (
      <div className={cn('flex items-center justify-center bg-neutral-950 text-neutral-400', className)}>
        <div className="text-center">
          <div className="mb-2 h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300 mx-auto" />
          <p className="text-sm">{isLoading ? `Loading ${title}...` : `Waiting for sandbox...`}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative bg-neutral-950', className)}>
      {!iframeLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950 text-neutral-400">
          <div className="text-center">
            <div className="mb-2 h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300 mx-auto" />
            <p className="text-sm">Loading {title}...</p>
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

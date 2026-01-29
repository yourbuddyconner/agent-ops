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
 * Base iframe panel with JWT token injection and loading state.
 * Token is appended as a query param so the auth gateway can validate it.
 *
 * The iframe URL is stabilized: once a token is obtained, the iframe keeps using
 * it until the base `src` changes. Token refreshes happen in the background and
 * only take effect if the iframe needs to reload for other reasons.
 */
export function IframePanel({ src, token, title, isLoading, className }: IframePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Stabilize the token: lock in the first valid token per src, only update
  // when src changes (not when the token refreshes in the background).
  const stableTokenRef = useRef<string | undefined>(undefined);
  const stableSrcRef = useRef<string | undefined>(undefined);

  if (src !== stableSrcRef.current) {
    // Base URL changed — accept new token and reset state
    stableSrcRef.current = src;
    stableTokenRef.current = token;
    setIframeLoaded(false);
  } else if (!stableTokenRef.current && token) {
    // First time getting a token for this src
    stableTokenRef.current = token;
  }

  const stableToken = stableTokenRef.current;

  // Append token as query param, using & if URL already has query params
  const fullUrl = src && stableToken
    ? `${src}${src.includes('?') ? '&' : '?'}token=${encodeURIComponent(stableToken)}`
    : undefined;

  useEffect(() => {
    setIframeLoaded(false);
  }, [fullUrl]);

  // Token unavailable after loading completed — show error with retry
  if (!isLoading && src && !stableToken) {
    return (
      <div className={cn('flex items-center justify-center bg-surface-0 text-neutral-500 dark:bg-surface-0 dark:text-neutral-400', className)}>
        <div className="text-center">
          <div className="mx-auto mb-3 h-5 w-5 rounded-full border-2 border-red-300 dark:border-red-600 flex items-center justify-center">
            <span className="text-red-500 text-[10px] font-bold">!</span>
          </div>
          <p className="font-mono text-[11px] text-red-600 dark:text-red-400">Sandbox token unavailable</p>
          <p className="font-mono text-[10px] mt-1 text-neutral-400 dark:text-neutral-500">The sandbox may still be starting up. Token will retry automatically.</p>
        </div>
      </div>
    );
  }

  if (isLoading || !fullUrl) {
    return (
      <div className={cn('flex items-center justify-center bg-surface-0 text-neutral-500 dark:bg-surface-0 dark:text-neutral-400', className)}>
        <div className="text-center">
          <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-accent dark:border-neutral-600 dark:border-t-accent" />
          <p className="font-mono text-[11px]">
            {isLoading ? `Loading ${title}...` : 'Waiting for sandbox...'}
          </p>
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
            <p className="font-mono text-[11px]">Connecting to {title}...</p>
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

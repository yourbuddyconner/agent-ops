import { IframePanel } from './iframe-panel';

interface VNCPanelProps {
  gatewayUrl: string | undefined;
  token: string | undefined;
  isLoading?: boolean;
  className?: string;
}

export function VNCPanel({ gatewayUrl, token, isLoading, className }: VNCPanelProps) {
  const src = gatewayUrl ? `${gatewayUrl}/vnc/` : undefined;

  return (
    <IframePanel
      src={src}
      token={token}
      title="Desktop"
      isLoading={isLoading}
      className={className}
    />
  );
}

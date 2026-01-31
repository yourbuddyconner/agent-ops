import { IframePanel } from './iframe-panel';

interface VNCPanelProps {
  gatewayUrl: string | undefined;
  token: string | undefined;
  isLoading?: boolean;
  statusMessage?: string;
  className?: string;
}

export function VNCPanel({ gatewayUrl, token, isLoading, statusMessage, className }: VNCPanelProps) {
  // Use vnc.html (full viewer) with parameters:
  // - path: WebSocket path with /vnc/ prefix for our gateway routing
  // - autoconnect: Connect automatically on load
  // - resize: Scale the display to fit the container
  // - view_clip: false to allow scaling instead of clipping
  const src = gatewayUrl
    ? `${gatewayUrl}/vnc/vnc.html?path=vnc/websockify&autoconnect=true&resize=scale&view_clip=false`
    : undefined;

  return (
    <IframePanel
      src={src}
      token={token}
      title="Desktop"
      isLoading={isLoading}
      statusMessage={statusMessage}
      className={className}
    />
  );
}

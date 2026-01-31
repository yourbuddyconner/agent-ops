import { IframePanel } from './iframe-panel';

interface TerminalPanelProps {
  gatewayUrl: string | undefined;
  token: string | undefined;
  isLoading?: boolean;
  statusMessage?: string;
  className?: string;
}

export function TerminalPanel({ gatewayUrl, token, isLoading, statusMessage, className }: TerminalPanelProps) {
  const src = gatewayUrl ? `${gatewayUrl}/ttyd/` : undefined;

  return (
    <IframePanel
      src={src}
      token={token}
      title="Terminal"
      isLoading={isLoading}
      statusMessage={statusMessage}
      className={className}
    />
  );
}

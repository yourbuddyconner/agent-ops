import { IframePanel } from './iframe-panel';

interface TerminalPanelProps {
  gatewayUrl: string | undefined;
  token: string | undefined;
  isLoading?: boolean;
  className?: string;
}

export function TerminalPanel({ gatewayUrl, token, isLoading, className }: TerminalPanelProps) {
  const src = gatewayUrl ? `${gatewayUrl}/ttyd/` : undefined;

  return (
    <IframePanel
      src={src}
      token={token}
      title="Terminal"
      isLoading={isLoading}
      className={className}
    />
  );
}

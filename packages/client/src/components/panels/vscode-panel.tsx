import { IframePanel } from './iframe-panel';

interface VSCodePanelProps {
  gatewayUrl: string | undefined;
  token: string | undefined;
  isLoading?: boolean;
  statusMessage?: string;
  className?: string;
}

export function VSCodePanel({ gatewayUrl, token, isLoading, statusMessage, className }: VSCodePanelProps) {
  const src = gatewayUrl ? `${gatewayUrl}/vscode/` : undefined;

  return (
    <IframePanel
      src={src}
      token={token}
      title="VS Code"
      isLoading={isLoading}
      statusMessage={statusMessage}
      className={className}
    />
  );
}

import { IframePanel } from './iframe-panel';

interface VSCodePanelProps {
  gatewayUrl: string | undefined;
  token: string | undefined;
  isLoading?: boolean;
  className?: string;
}

export function VSCodePanel({ gatewayUrl, token, isLoading, className }: VSCodePanelProps) {
  const src = gatewayUrl ? `${gatewayUrl}/vscode/` : undefined;

  return (
    <IframePanel
      src={src}
      token={token}
      title="VS Code"
      isLoading={isLoading}
      className={className}
    />
  );
}

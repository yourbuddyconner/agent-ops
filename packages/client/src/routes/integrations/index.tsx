import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { IntegrationList } from '@/components/integrations/integration-list';
import { ConnectIntegrationDialog } from '@/components/integrations/connect-integration-dialog';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/integrations/')({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const [connectDialogOpen, setConnectDialogOpen] = React.useState(false);

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect your tools and services"
        actions={
          <Button onClick={() => setConnectDialogOpen(true)}>
            Connect Integration
          </Button>
        }
      />

      <IntegrationList />

      <ConnectIntegrationDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
      />
    </PageContainer>
  );
}

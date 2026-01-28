import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { ContainerList } from '@/components/containers/container-list';
import { CreateContainerDialog } from '@/components/containers/create-container-dialog';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/containers/')({
  component: ContainersPage,
});

function ContainersPage() {
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  return (
    <PageContainer>
      <PageHeader
        title="Containers"
        description="Manage your OpenCode development environments"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)}>
            New Container
          </Button>
        }
      />
      <ContainerList />
      <CreateContainerDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </PageContainer>
  );
}

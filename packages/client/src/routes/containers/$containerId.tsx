import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useContainer, useDeleteContainer } from '@/api/containers';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ContainerActions } from '@/components/containers/container-actions';
import { EditContainerDialog } from '@/components/containers/edit-container-dialog';
import { OverviewTab } from '@/components/containers/overview-tab';
import { OpenCodeTab } from '@/components/containers/opencode-tab';

export const Route = createFileRoute('/containers/$containerId')({
  component: ContainerDetailPage,
});

function ContainerDetailPage() {
  const { containerId } = Route.useParams();
  const { data, isLoading, error } = useContainer(containerId);
  const deleteContainer = useDeleteContainer();
  const [activeTab, setActiveTab] = useState<'overview' | 'opencode'>('overview');

  const container = data?.container;

  const handleDelete = async () => {
    if (!container) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${container.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteContainer.mutateAsync(container.id);
      // Navigate back to containers list after successful deletion
      window.location.href = '/containers';
    } catch (err) {
      console.error('Failed to delete container:', err);
    }
  };

  if (isLoading) {
    return (
      <PageContainer>
        <ContainerDetailSkeleton />
      </PageContainer>
    );
  }

  if (error || !container) {
    return (
      <PageContainer>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">
            Failed to load container. It may not exist or you don't have access.
          </p>
          <Link
            to="/containers"
            className="mt-2 inline-block text-sm text-red-600 underline"
          >
            Back to containers
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={container.name}
        description={`OpenCode development environment`}
        actions={
          <div className="flex items-center gap-2">
            <ContainerActions container={container} />
            <EditContainerDialog container={container} />
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteContainer.isPending || container.status === 'starting' || container.status === 'stopping'}
            >
              {deleteContainer.isPending ? (
                <>
                  <LoadingSpinner className="mr-2 size-4" />
                  Deleting...
                </>
              ) : (
                <>
                  <TrashIcon className="mr-2 size-4" />
                  Delete
                </>
              )}
            </Button>
          </div>
        }
      />

      {/* Back link */}
      <div className="mb-4">
        <Link
          to="/containers"
          className="inline-flex items-center text-sm text-neutral-500 hover:text-neutral-900"
        >
          <BackIcon className="mr-1 size-4" />
          Back to containers
        </Link>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'overview' | 'opencode')}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="opencode">OpenCode</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab container={container} />
        </TabsContent>

        <TabsContent value="opencode">
          <OpenCodeTab container={container} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function ContainerDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`animate-spin ${className}`}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

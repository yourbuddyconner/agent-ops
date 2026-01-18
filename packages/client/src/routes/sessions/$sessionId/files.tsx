import { createFileRoute, Link } from '@tanstack/react-router';
import { FileBrowser } from '@/components/files/file-browser';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/sessions/$sessionId/files')({
  component: SessionFilesPage,
});

function SessionFilesPage() {
  const { sessionId } = Route.useParams();

  return (
    <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center gap-4">
          <Link to="/sessions/$sessionId" params={{ sessionId }}>
            <Button variant="ghost" size="sm">
              <BackIcon className="mr-2 h-4 w-4" />
              Back to Chat
            </Button>
          </Link>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Session Files
          </h1>
        </div>
      </div>

      {/* File browser */}
      <div className="flex-1 overflow-hidden p-4">
        <FileBrowser sessionId={sessionId} />
      </div>
    </div>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

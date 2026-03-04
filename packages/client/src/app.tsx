import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { preloadHighlighter } from '@pierre/diffs';
import { routeTree } from './routeTree.gen';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemeProvider } from '@/hooks/use-theme';

// Initialize Pierre's Shiki highlighter on the main thread.
// This runs once at module load — components will render plain text
// until the highlighter is ready, then re-render with syntax highlighting.
preloadHighlighter({
  themes: ['pierre-dark', 'pierre-light'],
  langs: ['typescript', 'javascript', 'json', 'python', 'bash', 'css', 'html', 'yaml', 'toml', 'sql', 'markdown', 'go', 'rust', 'jsx', 'tsx'],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

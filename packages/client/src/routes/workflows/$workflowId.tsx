import { createFileRoute, redirect } from '@tanstack/react-router';

const VALID_TABS = ['runs', 'steps', 'triggers', 'proposals', 'history'] as const;
type TabId = (typeof VALID_TABS)[number];

export const Route = createFileRoute('/workflows/$workflowId')({
  beforeLoad: ({ params, search }) => {
    const s = search as Record<string, unknown>;
    const tab: TabId = VALID_TABS.includes(s.tab as TabId) ? (s.tab as TabId) : 'runs';
    throw redirect({
      to: '/automation/workflows/$workflowId',
      params,
      search: {
        tab,
        ...(typeof s.run === 'string' ? { run: s.run } : {}),
      },
    });
  },
});

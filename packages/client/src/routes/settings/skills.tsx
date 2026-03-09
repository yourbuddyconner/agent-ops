import * as React from 'react';
import { createFileRoute, Link, Outlet, useMatch } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { SkillCard } from '@/components/skills/skill-card';
import { useSkills, useSearchSkills } from '@/api/skills';
import type { SkillSource } from '@/api/types';

export const Route = createFileRoute('/settings/skills')({
  component: SkillsLayout,
});

const sourceFilters: Array<{ label: string; value: SkillSource | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'Builtin', value: 'builtin' },
  { label: 'Plugin', value: 'plugin' },
  { label: 'Managed', value: 'managed' },
];

function SkillsLayout() {
  const childMatch = useMatch({ from: '/settings/skills/$id', shouldThrow: false });

  if (childMatch) {
    return <Outlet />;
  }

  return <SkillsListPage />;
}

function SkillsListPage() {
  const [search, setSearch] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState<SkillSource | undefined>(undefined);

  const { data: allSkills, isLoading: isLoadingAll } = useSkills(
    search ? undefined : { source: sourceFilter }
  );
  const { data: searchResults, isLoading: isLoadingSearch } = useSearchSkills(search);

  const skills = search ? searchResults : allSkills;
  const isLoading = search ? isLoadingSearch : isLoadingAll;

  return (
    <PageContainer>
      <PageHeader
        title="Skills"
        description="Browse and manage your skill library"
        actions={
          <Button asChild>
            <Link to="/settings/skills/$id" params={{ id: 'new' }}>
              Create Skill
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search skills..."
          />
        </div>
        <div className="flex gap-1">
          {sourceFilters.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => setSourceFilter(filter.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                sourceFilter === filter.value
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-700" />
          ))}
        </div>
      ) : !skills?.length ? (
        <div className="rounded-lg border border-dashed border-neutral-200 px-6 py-12 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {search
              ? `No skills matching "${search}"`
              : 'No skills found. Create one to get started.'}
          </p>
          {!search && (
            <Button className="mt-4" asChild>
              <Link to="/settings/skills/$id" params={{ id: 'new' }}>
                Create Your First Skill
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

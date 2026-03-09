import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import type { SkillSummary } from '@/api/types';

const sourceBadgeVariant = {
  builtin: 'default',
  plugin: 'secondary',
  managed: 'success',
} as const;

const visibilityBadgeVariant = {
  shared: 'default',
  private: 'secondary',
} as const;

interface SkillCardProps {
  skill: SkillSummary;
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <Link
      to="/settings/skills/$id"
      params={{ id: skill.id }}
      className="block rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600 dark:hover:bg-neutral-750"
    >
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
          {skill.name}
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge variant={sourceBadgeVariant[skill.source]}>{skill.source}</Badge>
          <Badge variant={visibilityBadgeVariant[skill.visibility]}>{skill.visibility}</Badge>
        </div>
      </div>

      {skill.description && (
        <p className="mt-2 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">
          {skill.description}
        </p>
      )}

      <div className="mt-3">
        <span className="text-xs text-neutral-400">
          Updated {new Date(skill.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </Link>
  );
}

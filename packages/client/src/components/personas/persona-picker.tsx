import * as React from 'react';
import { usePersonas } from '@/api/personas';
import { cn } from '@/lib/cn';
import type { AgentPersona } from '@/api/types';

interface PersonaPickerProps {
  value: string | undefined;
  onChange: (personaId: string | undefined) => void;
}

export function PersonaPicker({ value, onChange }: PersonaPickerProps) {
  const { data: personas, isLoading } = usePersonas();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selected = personas?.find((p) => p.id === value);

  const filtered = React.useMemo(() => {
    if (!personas) return [];
    if (!search.trim()) return personas;
    const q = search.toLowerCase();
    return personas.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
    );
  }, [personas, search]);

  const shared = filtered.filter((p) => p.visibility === 'shared');
  const priv = filtered.filter((p) => p.visibility === 'private');

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (isLoading) {
    return (
      <div className="h-9 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
    );
  }

  if (!personas?.length) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors',
          'border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600',
          selected && 'text-neutral-900 dark:text-neutral-100',
          !selected && 'text-neutral-400 dark:text-neutral-500'
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {selected ? (
            <>
              {selected.icon && <span>{selected.icon}</span>}
              <span>{selected.name}</span>
              {selected.isDefault && (
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  default
                </span>
              )}
            </>
          ) : (
            'Select persona (optional)'
          )}
        </span>
        {selected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(undefined);
            }}
            className="ml-2 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            Clear
          </button>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search personas..."
              className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {shared.length > 0 && (
              <PersonaGroup label="Shared" personas={shared} value={value} onSelect={(id) => { onChange(id); setOpen(false); setSearch(''); }} />
            )}
            {priv.length > 0 && (
              <PersonaGroup label="Private" personas={priv} value={value} onSelect={(id) => { onChange(id); setOpen(false); setSearch(''); }} />
            )}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-center text-sm text-neutral-400">No personas found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaGroup({
  label,
  personas,
  value,
  onSelect,
}: {
  label: string;
  personas: AgentPersona[];
  value: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {label}
      </div>
      {personas.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
            'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
            value === p.id && 'bg-neutral-50 dark:bg-neutral-800/50'
          )}
        >
          {p.icon && <span className="text-base">{p.icon}</span>}
          <div className="min-w-0 flex-1">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{p.name}</span>
            {p.isDefault && (
              <span className="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                default
              </span>
            )}
            {p.description && (
              <p className="truncate text-xs text-neutral-400">{p.description}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

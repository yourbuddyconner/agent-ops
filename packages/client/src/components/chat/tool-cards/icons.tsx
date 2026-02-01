/** Compact SVG icons for tool cards. 16x16 viewBox, stroke-based. */

export function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5z" />
      <polyline points="9.5 1.5 9.5 5 13 5" />
    </svg>
  );
}

export function FileEditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3" />
      <polyline points="9.5 1.5 9.5 5 13 5" />
      <path d="M10.5 11.5l1.5-1.5 2 2-1.5 1.5-2-2z" />
    </svg>
  );
}

export function FilePlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5z" />
      <polyline points="9.5 1.5 9.5 5 13 5" />
      <line x1="8" y1="8.5" x2="8" y2="12.5" />
      <line x1="6" y1="10.5" x2="10" y2="10.5" />
    </svg>
  );
}

export function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <polyline points="4.5 6 6.5 8 4.5 10" />
      <line x1="8" y1="10" x2="11" y2="10" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.2" y1="10.2" x2="14" y2="14" />
    </svg>
  );
}

export function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="4" x2="13" y2="4" />
      <line x1="5" y1="8" x2="13" y2="8" />
      <line x1="5" y1="12" x2="13" y2="12" />
      <circle cx="2.5" cy="4" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2 4 3 5 5 3" />
      <line x1="7" y1="4" x2="14" y2="4" />
      <polyline points="2 8 3 9 5 7" />
      <line x1="7" y1="8" x2="14" y2="8" />
      <rect x="2" y="11" width="3" height="2" rx="0.5" />
      <line x1="7" y1="12" x2="14" y2="12" />
    </svg>
  );
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8.5z" />
    </svg>
  );
}

export function GrepIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="6.5" r="4" />
      <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" />
      <line x1="4.5" y1="6.5" x2="8.5" y2="6.5" />
    </svg>
  );
}

export function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 2.5a3.5 3.5 0 0 0-4 5.6L3 11.6l1.4 1.4 3.5-3.5a3.5 3.5 0 0 0 5.6-4l-2 2-1.5-.5-.5-1.5 2-2z" />
    </svg>
  );
}

export function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6 6.5a2 2 0 0 1 3.9.5c0 1.3-2 1.5-2 3" />
      <circle cx="8" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13" />
      <path d="M8 1.5c2 2.3 2.5 4.2 2.5 6.5s-.5 4.2-2.5 6.5" />
      <path d="M8 1.5c-2 2.3-2.5 4.2-2.5 6.5s.5 4.2 2.5 6.5" />
    </svg>
  );
}

export function PatchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5z" />
      <polyline points="9.5 1.5 9.5 5 13 5" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" />
      <line x1="5.5" y1="10.5" x2="10.5" y2="10.5" />
      <line x1="5.5" y1="8" x2="5.5" y2="10.5" />
    </svg>
  );
}

export function LspIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 5 1.5 8 4 11" />
      <polyline points="12 5 14.5 8 12 11" />
      <line x1="9.5" y1="3" x2="6.5" y2="13" />
    </svg>
  );
}

export function SkillIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="8 1.5 9.8 5.5 14 6 11 9 11.8 13.5 8 11.5 4.2 13.5 5 9 2 6 6.2 5.5" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

import { useMemo } from 'react';
import type { Message } from '@/api/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface ChannelOption {
  label: string;
  channelType: string;
  channelId: string;
  messageCount: number;
}

/** Scan messages for unique channelType:channelId pairs. */
export function deriveChannels(messages: Message[]): ChannelOption[] {
  const counts = new Map<string, { channelType: string; channelId: string; count: number }>();

  for (const msg of messages) {
    const ct = msg.channelType || 'web';
    const ci = msg.channelId || 'default';
    const key = `${ct}:${ci}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { channelType: ct, channelId: ci, count: 1 });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => {
      // web first, then alphabetical
      if (a.channelType === 'web' && b.channelType !== 'web') return -1;
      if (b.channelType === 'web' && a.channelType !== 'web') return 1;
      return a.channelType.localeCompare(b.channelType) || a.channelId.localeCompare(b.channelId);
    })
    .map((c) => ({
      label: formatChannelLabel(c.channelType, c.channelId),
      channelType: c.channelType,
      channelId: c.channelId,
      messageCount: c.count,
    }));
}

function formatChannelLabel(channelType: string, channelId: string): string {
  if (channelType === 'web') return 'Web';
  if (channelType === 'slack') return channelId === 'default' ? 'Slack' : `Slack #${channelId}`;
  if (channelType === 'telegram') return channelId === 'default' ? 'Telegram' : `Telegram`;
  return channelId === 'default' ? channelType : `${channelType}:${channelId}`;
}

function channelIcon(channelType: string): React.ReactNode {
  if (channelType === 'telegram') return <TelegramIcon className="h-3 w-3" />;
  if (channelType === 'slack') return <SlackIcon className="h-3 w-3" />;
  if (channelType === 'web') return <GlobeIcon className="h-3 w-3" />;
  return <ChannelGenericIcon className="h-3 w-3" />;
}

interface ChannelSwitcherProps {
  channels: ChannelOption[];
  selectedChannel: string | null; // "channelType:channelId" or null for all
  onSelectChannel: (key: string | null) => void;
}

export function ChannelSwitcher({ channels, selectedChannel, onSelectChannel }: ChannelSwitcherProps) {
  const selectedOption = useMemo(
    () => (selectedChannel ? channels.find((c) => `${c.channelType}:${c.channelId}` === selectedChannel) : null),
    [channels, selectedChannel]
  );

  const label = selectedOption ? selectedOption.label : 'All channels';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-500 transition-colors hover:bg-surface-1 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-surface-2 dark:hover:text-neutral-200"
        >
          {selectedOption ? channelIcon(selectedOption.channelType) : <ChannelsIcon className="h-3 w-3" />}
          <span>{label}</span>
          <ChevronDownIcon className="h-2.5 w-2.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <DropdownMenuItem
          onClick={() => onSelectChannel(null)}
          className={!selectedChannel ? 'bg-surface-2 font-semibold' : ''}
        >
          <ChannelsIcon className="mr-2 h-3 w-3 text-neutral-400" />
          <span className="flex-1">All channels</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {channels.map((ch) => {
          const key = `${ch.channelType}:${ch.channelId}`;
          return (
            <DropdownMenuItem
              key={key}
              onClick={() => onSelectChannel(key)}
              className={selectedChannel === key ? 'bg-surface-2 font-semibold' : ''}
            >
              <span className="mr-2">{channelIcon(ch.channelType)}</span>
              <span className="flex-1">{ch.label}</span>
              <span className="ml-2 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                {ch.messageCount}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function ChannelGenericIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function ChannelsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 20h.01" />
      <path d="M7 20v-4" />
      <path d="M12 20v-8" />
      <path d="M17 20V8" />
      <path d="M22 4v16" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

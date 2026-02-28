// ─── Channel Metadata (display info for UI) ─────────────────────────────────

export interface ChannelCapabilities {
  supportsEditing: boolean;
  supportsDeleting: boolean;
  supportsThreads: boolean;
  supportsTypingIndicator: boolean;
  supportsAttachments: boolean;
}

export interface ChannelMeta {
  channelType: string;
  displayName: string;
  iconId: string;
  capabilities: ChannelCapabilities;
}

// ─── Known Channel Registry ─────────────────────────────────────────────────

const knownChannels: ChannelMeta[] = [
  {
    channelType: 'web',
    displayName: 'Web',
    iconId: 'web',
    capabilities: {
      supportsEditing: false,
      supportsDeleting: false,
      supportsThreads: false,
      supportsTypingIndicator: false,
      supportsAttachments: true,
    },
  },
  {
    channelType: 'telegram',
    displayName: 'Telegram',
    iconId: 'telegram',
    capabilities: {
      supportsEditing: true,
      supportsDeleting: true,
      supportsThreads: false,
      supportsTypingIndicator: true,
      supportsAttachments: true,
    },
  },
  {
    channelType: 'slack',
    displayName: 'Slack',
    iconId: 'slack',
    capabilities: {
      supportsEditing: true,
      supportsDeleting: true,
      supportsThreads: true,
      supportsTypingIndicator: true,
      supportsAttachments: true,
    },
  },
  {
    channelType: 'github',
    displayName: 'GitHub',
    iconId: 'github',
    capabilities: {
      supportsEditing: true,
      supportsDeleting: true,
      supportsThreads: true,
      supportsTypingIndicator: false,
      supportsAttachments: false,
    },
  },
  {
    channelType: 'api',
    displayName: 'API',
    iconId: 'api',
    capabilities: {
      supportsEditing: false,
      supportsDeleting: false,
      supportsThreads: false,
      supportsTypingIndicator: false,
      supportsAttachments: true,
    },
  },
];

const channelMetaMap = new Map<string, ChannelMeta>(
  knownChannels.map((m) => [m.channelType, m]),
);

/** Get display metadata for a channel type. Returns a generic fallback for unknown types. */
export function getChannelMeta(channelType: string): ChannelMeta {
  return channelMetaMap.get(channelType) ?? {
    channelType,
    displayName: channelType.charAt(0).toUpperCase() + channelType.slice(1),
    iconId: 'generic',
    capabilities: {
      supportsEditing: false,
      supportsDeleting: false,
      supportsThreads: false,
      supportsTypingIndicator: false,
      supportsAttachments: false,
    },
  };
}

/** List all known channel metadata entries. */
export function listChannelMeta(): ChannelMeta[] {
  return [...knownChannels];
}

/** Format a channel label for display. */
export function formatChannelLabel(channelType: string, channelId: string): string {
  const meta = getChannelMeta(channelType);
  if (channelType === 'web') return meta.displayName;
  if (channelType === 'slack') return channelId === 'default' ? meta.displayName : `Slack #${channelId}`;
  if (channelId === 'default') return meta.displayName;
  return meta.displayName;
}

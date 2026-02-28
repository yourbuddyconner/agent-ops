import type { ChannelPackage } from '@agent-ops/sdk';
import telegramChannelPackage from '@agent-ops/channel-telegram';
import slackChannelPackage from '@agent-ops/channel-slack';

/** All installed channel packages. Add new channels here. */
export const installedChannels: ChannelPackage[] = [
  telegramChannelPackage,
  slackChannelPackage,
];

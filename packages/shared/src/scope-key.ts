export function webManualScopeKey(userId: string, sessionId: string): string {
  return `user:${userId}:manual:${sessionId}`;
}

export function slackScopeKey(userId: string, teamId: string, channelId: string, threadTs: string): string {
  return `user:${userId}:slack:${teamId}:${channelId}:${threadTs}`;
}

export function githubPrScopeKey(userId: string, repoFullName: string, prNumber: number): string {
  return `user:${userId}:github:${repoFullName}:pr:${prNumber}`;
}

export function apiScopeKey(userId: string, idempotencyKey: string): string {
  return `user:${userId}:api:${idempotencyKey}`;
}

export function telegramScopeKey(userId: string, chatId: string): string {
  return `user:${userId}:telegram:${chatId}`;
}

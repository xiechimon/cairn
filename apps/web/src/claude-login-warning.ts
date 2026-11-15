import type { ClaudeLoginNotice, ClaudeSubscription } from '@cairn/shared';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function formatClaudeLoginWarning(
  notice: ClaudeLoginNotice,
  name: string,
  t: Translate,
): string {
  if (notice.kind === 'expired') {
    return t(
      '{name} 上的 Claude Code 登录已过期。在该执行机上运行 `claude auth login` 重新登录。',
      {
        name,
      },
    );
  }
  if (notice.days === null) {
    return t(
      '{name} 上的 Claude Code 登录将在不到 1 天内过期。在该执行机上运行 `claude auth login` 重新登录。',
      { name },
    );
  }
  if (notice.days === 1) {
    return t(
      '{name} 上的 Claude Code 登录将在 1 天后过期。在该执行机上运行 `claude auth login` 重新登录。',
      { name },
    );
  }
  return t(
    '{name} 上的 Claude Code 登录将在 {days} 天后过期。在该执行机上运行 `claude auth login` 重新登录。',
    { name, days: notice.days },
  );
}

export function subscriptionLoginWarning(
  connection: ClaudeSubscription,
  now: number,
  t: Translate,
): string | null {
  if (connection.expiresAt === null || connection.expiresAt - now > 30 * 24 * 60 * 60 * 1000)
    return null;
  if (connection.expiresAt <= now)
    return t(
      '{name}：Claude 订阅的 token 已过期。运行 `claude setup-token`，再添加一个新的订阅。',
      { name: connection.label },
    );
  return t(
    '{name}：Claude 订阅的 token 将在 {days} 天后过期。运行 `claude setup-token`，再添加一个新的订阅。',
    {
      name: connection.label,
      days: Math.ceil((connection.expiresAt - now) / (24 * 60 * 60 * 1000)),
    },
  );
}

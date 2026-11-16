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
  if (connection.enabled === false) return null;
  if (connection.expiresAt === null || connection.expiresAt - now > 30 * 24 * 60 * 60 * 1000)
    return null;
  if (connection.expiresAt <= now)
    return t(
      '{name}：已过期，Coordinator 和任务都暂时用不了。在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型服务」。',
      { name: connection.label },
    );
  return t(
    '{name}：将在 {days} 天后过期。到期前在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型服务」。',
    {
      name: connection.label,
      days: Math.ceil((connection.expiresAt - now) / (24 * 60 * 60 * 1000)),
    },
  );
}

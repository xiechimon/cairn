import type { ClaudeSubscription } from '@cairn/shared';

type Translate = (key: string, params?: Record<string, string | number>) => string;

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

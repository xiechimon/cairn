import type { DevinSubscription } from '@cairn/shared';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function devinSubscriptionLoginWarning(
  subscription: DevinSubscription,
  now: number,
  t: Translate,
): string | null {
  if (subscription.enabled === false) return null;
  if (subscription.expiresAt === null || subscription.expiresAt - now > 30 * 24 * 60 * 60 * 1000)
    return null;
  if (subscription.expiresAt <= now)
    return t(
      '{name}：已过期，Coordinator 和任务暂时无法使用。在已登录 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出添加到「设置 → 模型路由」。',
      { name: subscription.label },
    );
  return t(
    '{name}：将在 {days} 天后过期。到期前在已登录 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出添加到「设置 → 模型路由」。',
    {
      name: subscription.label,
      days: Math.ceil((subscription.expiresAt - now) / (24 * 60 * 60 * 1000)),
    },
  );
}

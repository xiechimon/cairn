import type { DevinSubscription } from '@cairn/shared';
import { subscriptionExpiryWarning } from './subscription-login-warning.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function devinSubscriptionLoginWarning(
  subscription: DevinSubscription,
  now: number,
  t: Translate,
  coordinatorUsesIt: boolean,
): string | null {
  return subscriptionExpiryWarning(subscription, now, {
    expired: (name) =>
      coordinatorUsesIt
        ? t(
            '{name}：已过期，Coordinator 和任务暂时无法使用。在已登录 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出添加到「设置 → 模型」。',
            { name },
          )
        : t(
            '{name}：已过期，使用它的任务暂时无法运行。在已登录 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出添加到「设置 → 模型」。',
            { name },
          ),
    expiring: (name, days) =>
      t(
        '{name}：将在 {days} 天后过期。到期前在已登录 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出添加到「设置 → 模型」。',
        { name, days },
      ),
  });
}

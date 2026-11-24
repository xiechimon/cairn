import type { ClaudeSubscription } from '@cairn/shared';
import { subscriptionExpiryWarning } from './subscription-login-warning.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function subscriptionLoginWarning(
  connection: ClaudeSubscription,
  now: number,
  t: Translate,
): string | null {
  return subscriptionExpiryWarning(connection, now, {
    expired: (name) =>
      t(
        '{name}：已过期，Coordinator 和任务暂时无法使用。在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型路由」。',
        { name },
      ),
    expiring: (name, days) =>
      t(
        '{name}：将在 {days} 天后过期。到期前在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型路由」。',
        { name, days },
      ),
  });
}

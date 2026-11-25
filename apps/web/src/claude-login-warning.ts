import type { ClaudeSubscription } from '@cairn/shared';
import { subscriptionExpiryWarning } from './subscription-login-warning.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function subscriptionLoginWarning(
  connection: ClaudeSubscription,
  now: number,
  t: Translate,
  coordinatorUsesIt: boolean,
): string | null {
  return subscriptionExpiryWarning(connection, now, {
    expired: (name) =>
      coordinatorUsesIt
        ? t(
            '{name}：已过期，Coordinator 和任务暂时无法使用。在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型」。',
            { name },
          )
        : t(
            '{name}：已过期，使用它的任务暂时无法运行。在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型」。',
            { name },
          ),
    expiring: (name, days) =>
      t(
        '{name}：将在 {days} 天后过期。到期前在终端运行 `claude setup-token`，把新的 token 添加到「设置 → 模型」。',
        { name, days },
      ),
  });
}

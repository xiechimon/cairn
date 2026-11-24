import type { AntigravitySubscription, AntigravitySubscriptionListEntry } from '@cairn/shared';
import { subscriptionExpiryWarning } from './subscription-login-warning.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function antigravitySubscriptionLoginWarning(
  subscription: AntigravitySubscription,
  now: number,
  t: Translate,
): string | null {
  return subscriptionExpiryWarning(subscription, now, {
    expired: (name) =>
      t(
        '{name}：已过期，Coordinator 和任务暂时无法使用。在执行机重新登录 Google 账号或更新 API key 后，添加到「设置 → 模型路由」。',
        { name },
      ),
    expiring: (name, days) =>
      t(
        '{name}：将在 {days} 天后过期。到期前在执行机重新登录 Google 账号或更新 API key 后，添加到「设置 → 模型路由」。',
        { name, days },
      ),
  });
}

export function antigravitySubscriptionSignedOutWarning(
  subscription: AntigravitySubscriptionListEntry,
  t: Translate,
): string | null {
  if (
    subscription.enabled === false ||
    subscription.hasToken !== false ||
    subscription.runnerLogin === undefined ||
    subscription.runnerLogin === 'ok'
  )
    return null;
  if (subscription.runnerOffline === true) return t('执行机离线');
  return t(
    '{name}：执行机上没有可用的 Antigravity 登录，Coordinator 和任务暂时无法使用。在「设置 → 模型路由」重新登录。',
    { name: subscription.label },
  );
}

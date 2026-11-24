import {
  antigravitySubscriptionLoginWarning,
  antigravitySubscriptionSignedOutWarning,
} from '../antigravity-login-warning.js';
import { useAntigravitySubscriptions } from '../api/antigravity-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { useI18n } from '../i18n/provider.js';
import {
  expiryWarningKind,
  SubscriptionLoginBanner,
  type SubscriptionLoginWarning,
} from './subscription-login-banner.js';

export type AntigravityLoginWarning = SubscriptionLoginWarning<
  'expired' | 'expiring' | 'signed-out'
>;

export function useAntigravityLoginWarnings(now: number): AntigravityLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useAntigravitySubscriptions(teamId, live);
  return (subscriptions.data ?? []).flatMap((subscription): AntigravityLoginWarning[] => {
    const expiringText = antigravitySubscriptionLoginWarning(subscription, now, t);
    if (expiringText !== null) {
      return [
        {
          key: subscription.id,
          kind: expiryWarningKind(subscription.expiresAt, now),
          text: expiringText,
        },
      ];
    }
    const signedOutText = antigravitySubscriptionSignedOutWarning(subscription, t);
    return signedOutText === null
      ? []
      : [{ key: subscription.id, kind: 'signed-out' as const, text: signedOutText }];
  });
}

export function AntigravityLoginBanner({
  warnings,
}: {
  warnings: readonly AntigravityLoginWarning[];
}) {
  const { t } = useI18n();
  return (
    <SubscriptionLoginBanner
      testIdPrefix="antigravity"
      warnings={warnings}
      singleTitle={t('Antigravity 登录需要处理')}
      summary={(items) => {
        const expired = items.filter((warning) => warning.kind === 'expired').length;
        const signedOut = items.filter((warning) => warning.kind === 'signed-out').length;
        const expiring = items.length - expired - signedOut;
        return {
          title:
            expiring === 0 && signedOut === 0
              ? t('{count} 处 Antigravity 登录已过期', { count: expired })
              : expired === 0 && signedOut === 0
                ? t('{count} 处 Antigravity 登录即将过期', { count: expiring })
                : [
                    expired === 0 ? null : t('{count} 处已过期', { count: expired }),
                    signedOut === 0 ? null : t('{count} 处登录失效', { count: signedOut }),
                    expiring === 0 ? null : t('{count} 处即将过期', { count: expiring }),
                  ]
                    .filter((part): part is string => part !== null)
                    .join('，'),
          body:
            expired === 0 && signedOut === 0
              ? t('到期前更新登录或 API key，任务才不会中断。')
              : t('更新登录或 API key 之前，这些订阅不会接收新任务。'),
        };
      }}
    />
  );
}

import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { subscriptionLoginWarning } from '../claude-login-warning.js';
import { useI18n } from '../i18n/provider.js';
import {
  expiryWarningKind,
  SubscriptionLoginBanner,
  type SubscriptionLoginWarning,
} from './subscription-login-banner.js';

export type ClaudeLoginWarning = SubscriptionLoginWarning<'expired' | 'expiring'>;

export function useClaudeLoginWarnings(now: number): ClaudeLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useClaudeSubscriptions(teamId, live);
  return (subscriptions.data ?? []).flatMap((connection) => {
    const text = subscriptionLoginWarning(connection, now, t);
    return text === null
      ? []
      : [{ key: connection.id, kind: expiryWarningKind(connection.expiresAt, now), text }];
  });
}

export function ClaudeLoginBanner({ warnings }: { warnings: readonly ClaudeLoginWarning[] }) {
  const { t } = useI18n();
  return (
    <SubscriptionLoginBanner
      testIdPrefix="claude"
      warnings={warnings}
      singleTitle={t('Claude 登录需要处理')}
      summary={(items) => {
        const expired = items.filter((warning) => warning.kind === 'expired').length;
        const expiring = items.length - expired;
        return {
          title:
            expiring === 0
              ? t('{count} 处 Claude 登录已过期', { count: expired })
              : expired === 0
                ? t('{count} 处 Claude 登录即将过期', { count: expiring })
                : t('{expired} 处已过期，{expiring} 处即将过期', { expired, expiring }),
          body:
            expired === 0
              ? t('到期前换上新的 token，任务才不会中断。')
              : t('换上新的 token 之前，这些订阅不会接新任务。'),
        };
      }}
    />
  );
}

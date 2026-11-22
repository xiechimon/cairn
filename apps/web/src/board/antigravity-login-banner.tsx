import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import {
  antigravityRunnersSignedOut,
  antigravitySubscriptionLoginWarning,
  antigravitySubscriptionSignedOutWarning,
} from '../antigravity-login-warning.js';
import { useAntigravitySubscriptions } from '../api/antigravity-subscriptions.js';
import { useMachines } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';

export interface AntigravityLoginWarning {
  key: string;
  kind: 'expired' | 'expiring' | 'signed-out';
  text: string;
}

export function useAntigravityLoginWarnings(now: number): AntigravityLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useAntigravitySubscriptions(teamId, live);
  const machines = useMachines(teamId, live);
  const signedOut = antigravityRunnersSignedOut(machines.data);
  return (subscriptions.data ?? []).flatMap((subscription): AntigravityLoginWarning[] => {
    const expiringText = antigravitySubscriptionLoginWarning(subscription, now, t);
    if (expiringText !== null) {
      return [
        {
          key: subscription.id,
          kind:
            subscription.expiresAt !== null && subscription.expiresAt <= now
              ? ('expired' as const)
              : ('expiring' as const),
          text: expiringText,
        },
      ];
    }
    const signedOutText =
      signedOut === true ? antigravitySubscriptionSignedOutWarning(subscription, t) : null;
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
  const [only] = warnings;
  if (only === undefined) return null;
  if (warnings.length === 1) {
    return (
      <NoticeBanner
        data-testid="antigravity-login-banner"
        tone="warning"
        icon={KeyRound}
        className="mt-4"
        title={t('Antigravity 登录需要处理')}
        body={
          <span data-testid="antigravity-login-warning" data-login={only.kind}>
            {withCodeSpans(only.text)}
          </span>
        }
      />
    );
  }
  const expired = warnings.filter((warning) => warning.kind === 'expired').length;
  const signedOut = warnings.filter((warning) => warning.kind === 'signed-out').length;
  const expiring = warnings.length - expired - signedOut;
  const title =
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
            .join('，');
  const body =
    expired === 0 && signedOut === 0
      ? t('到期前更新登录或 API Key，任务才不会中断。')
      : t('更新登录或 API Key 之前，这些订阅不会接新任务。');
  return (
    <NoticeBanner
      data-testid="antigravity-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={title}
      body={<span data-testid="antigravity-login-summary">{body}</span>}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="px-3"
          render={<Link to={settingsHref('routing')} />}
        >
          {t('查看')}
        </Button>
      }
    />
  );
}

import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import { antigravitySubscriptionLoginWarning } from '../antigravity-login-warning.js';
import { useAntigravitySubscriptions } from '../api/antigravity-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';

export interface AntigravityLoginWarning {
  key: string;
  kind: 'expired' | 'expiring';
  text: string;
}

export function useAntigravityLoginWarnings(now: number): AntigravityLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useAntigravitySubscriptions(teamId, live);
  return (subscriptions.data ?? []).flatMap((subscription) => {
    const text = antigravitySubscriptionLoginWarning(subscription, now, t);
    return text === null
      ? []
      : [
          {
            key: subscription.id,
            kind:
              subscription.expiresAt !== null && subscription.expiresAt <= now
                ? ('expired' as const)
                : ('expiring' as const),
            text,
          },
        ];
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
  const expiring = warnings.length - expired;
  const title =
    expiring === 0
      ? t('{count} 处 Antigravity 登录已过期', { count: expired })
      : expired === 0
        ? t('{count} 处 Antigravity 登录即将过期', { count: expiring })
        : t('{expired} 处已过期，{expiring} 处即将过期', { expired, expiring });
  const body =
    expired === 0
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

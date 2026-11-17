import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import { useDevinSubscriptions } from '../api/devin-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { devinSubscriptionLoginWarning } from '../devin-login-warning.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';

export interface DevinLoginWarning {
  key: string;
  kind: 'expired' | 'expiring';
  text: string;
}

export function useDevinLoginWarnings(now: number): DevinLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useDevinSubscriptions(teamId, live);
  return (subscriptions.data ?? []).flatMap((subscription) => {
    const text = devinSubscriptionLoginWarning(subscription, now, t);
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

export function DevinLoginBanner({ warnings }: { warnings: readonly DevinLoginWarning[] }) {
  const { t } = useI18n();
  const [only] = warnings;
  if (only === undefined) return null;
  if (warnings.length === 1) {
    return (
      <NoticeBanner
        data-testid="devin-login-banner"
        tone="warning"
        icon={KeyRound}
        className="mt-4"
        title={t('Devin 登录需要处理')}
        body={
          <span data-testid="devin-login-warning" data-login={only.kind}>
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
      ? t('{count} 处 Devin 登录已过期', { count: expired })
      : expired === 0
        ? t('{count} 处 Devin 登录即将过期', { count: expiring })
        : t('{expired} 处已过期，{expiring} 处即将过期', { expired, expiring });
  const body =
    expired === 0
      ? t('到期前换上新的 token，任务才不会中断。')
      : t('换上新的 token 之前，这些订阅不会接新任务。');
  return (
    <NoticeBanner
      data-testid="devin-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={title}
      body={<span data-testid="devin-login-summary">{body}</span>}
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

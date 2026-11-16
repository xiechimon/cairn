import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { subscriptionLoginWarning } from '../claude-login-warning.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';

export interface ClaudeLoginWarning {
  key: string;
  kind: 'expired' | 'expiring';
  text: string;
}

export function useClaudeLoginWarnings(now: number): ClaudeLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useClaudeSubscriptions(teamId, live);
  return (subscriptions.data ?? []).flatMap((connection) => {
    const text = subscriptionLoginWarning(connection, now, t);
    return text === null
      ? []
      : [
          {
            key: connection.id,
            kind:
              connection.expiresAt !== null && connection.expiresAt <= now
                ? ('expired' as const)
                : ('expiring' as const),
            text,
          },
        ];
  });
}

export function ClaudeLoginBanner({ warnings }: { warnings: readonly ClaudeLoginWarning[] }) {
  const { t } = useI18n();
  const [only] = warnings;
  if (only === undefined) return null;
  if (warnings.length === 1) {
    return (
      <NoticeBanner
        data-testid="claude-login-banner"
        tone="warning"
        icon={KeyRound}
        className="mt-4"
        title={t('Claude 登录需要处理')}
        body={
          <span data-testid="claude-login-warning" data-login={only.kind}>
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
      ? t('{count} 处 Claude 登录已过期', { count: expired })
      : expired === 0
        ? t('{count} 处 Claude 登录即将过期', { count: expiring })
        : t('{expired} 处已过期，{expiring} 处即将过期', { expired, expiring });
  const body =
    expired === 0
      ? t('到期前换上新的 token，任务才不会中断。')
      : t('换上新的 token 之前，这些订阅不会接新任务。');
  return (
    <NoticeBanner
      data-testid="claude-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={title}
      body={<span data-testid="claude-login-summary">{body}</span>}
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

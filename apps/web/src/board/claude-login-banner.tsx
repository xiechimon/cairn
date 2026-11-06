import { claudeLoginNotice } from '@cairn/shared';
import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { formatClaudeLoginWarning, subscriptionLoginWarning } from '../claude-login-warning.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { MACHINES_HREF } from '../resources/machines-page.js';

export interface ClaudeLoginWarning {
  key: string;
  kind: 'expired' | 'expiring';
  text: string;
}

export function useClaudeLoginWarnings(
  machines: readonly MachineRow[] = [],
  now: number,
): ClaudeLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useClaudeSubscriptions(teamId, live);
  return [
    ...machines.flatMap((machine) => {
      const notice = claudeLoginNotice(machine.claudeLogin, now);
      return notice === null
        ? []
        : [
            {
              key: machine.id ?? machine.name,
              kind: notice.kind,
              text: formatClaudeLoginWarning(notice, machine.name, t),
            },
          ];
    }),
    ...(subscriptions.data ?? []).flatMap((connection) => {
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
    }),
  ];
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
      ? t('到期前重新登录，任务才不会中断。')
      : t('重新登录前，这些机器和订阅不会接新任务。');
  return (
    <NoticeBanner
      data-testid="claude-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={title}
      body={<span data-testid="claude-login-summary">{body}</span>}
      actions={
        <Button variant="outline" size="sm" className="px-3" render={<Link to={MACHINES_HREF} />}>
          {t('查看')}
        </Button>
      }
    />
  );
}

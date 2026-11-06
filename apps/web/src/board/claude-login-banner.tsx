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
  return (
    <NoticeBanner
      data-testid="claude-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={t('{count} 处 Claude 登录需要处理', { count: warnings.length })}
      body={
        <span data-testid="claude-login-summary">
          {expired === warnings.length
            ? t('都已过期。')
            : t('{expired} 处已过期，其余快到期。', { expired })}
        </span>
      }
      actions={
        <Button variant="outline" size="sm" className="px-3" render={<Link to={MACHINES_HREF} />}>
          {t('查看')}
        </Button>
      }
    />
  );
}

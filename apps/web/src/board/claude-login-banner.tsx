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
import { PROVIDERS_HREF } from '../resources/hrefs.js';
import { MACHINES_HREF } from '../resources/machines-page.js';

export interface ClaudeLoginWarning {
  key: string;
  source: 'machine' | 'subscription';
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
              source: 'machine' as const,
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
              source: 'subscription' as const,
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

export type LoginBannerLinkId = 'machines' | 'subscriptions';

export function loginBannerLinks(
  warnings: readonly Pick<ClaudeLoginWarning, 'source'>[],
): { id: LoginBannerLinkId; href: string }[] {
  const links: { id: LoginBannerLinkId; href: string }[] = [];
  if (warnings.some((warning) => warning.source === 'machine'))
    links.push({ id: 'machines', href: MACHINES_HREF });
  if (warnings.some((warning) => warning.source === 'subscription'))
    links.push({ id: 'subscriptions', href: PROVIDERS_HREF });
  return links;
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
  const links = loginBannerLinks(warnings);
  const title =
    expiring === 0
      ? t('{count} 处 Claude 登录已过期', { count: expired })
      : expired === 0
        ? t('{count} 处 Claude 登录即将过期', { count: expiring })
        : t('{expired} 处已过期，{expiring} 处即将过期', { expired, expiring });
  const body =
    expired === 0
      ? t('到期前重新登录，任务才不会中断。')
      : t('重新登录前，这些 Runner 和订阅不会接新任务。');
  return (
    <NoticeBanner
      data-testid="claude-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={title}
      body={<span data-testid="claude-login-summary">{body}</span>}
      actions={links.map((link) => (
        <Button
          key={link.id}
          variant="outline"
          size="sm"
          className="px-3"
          render={<Link to={link.href} />}
        >
          {links.length === 1
            ? t('查看')
            : link.id === 'machines'
              ? t('查看 Runner')
              : t('查看订阅')}
        </Button>
      ))}
    />
  );
}

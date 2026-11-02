import { claudeLoginNotice } from '@cairn/shared';
import { KeyRound } from 'lucide-react';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { useLiveData } from '../api/provider.js';
import { formatClaudeLoginWarning, subscriptionLoginWarning } from '../claude-login-warning.js';
import { NoticeBanner } from '../components/notice-banner.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export function ClaudeLoginBanner({
  machines = [],
  now,
}: {
  machines?: readonly MachineRow[];
  now: number;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useClaudeSubscriptions(teamId, live);
  const warnings = [
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
  if (warnings.length === 0) return null;
  return (
    <NoticeBanner
      data-testid="claude-login-banner"
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={t('Claude 登录需要处理')}
      body={
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {warnings.map((warning) => (
            <li
              key={warning.key}
              data-testid="claude-login-warning"
              data-login={warning.kind}
              role="status"
            >
              {warning.text}
            </li>
          ))}
        </ul>
      }
    />
  );
}

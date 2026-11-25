import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  useClaudeSubscriptions,
  useCreateClaudeSubscription,
} from '../api/claude-subscriptions.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { subscriptionLoginWarning } from '../claude-login-warning.js';
import { coordinatorProviderOf } from '../coordinator-provider.js';
import { useI18n } from '../i18n/provider.js';
import { AddClaudeSubscriptionDialog } from '../resources/claude-subscriptions.js';
import {
  expiryWarningKind,
  SubscriptionLoginBanner,
  type SubscriptionLoginWarning,
} from './subscription-login-banner.js';

export type ClaudeLoginWarning = SubscriptionLoginWarning<'expired' | 'expiring'> & {
  subscriptionId: string;
  label: string;
};

export function useClaudeLoginWarnings(now: number): ClaudeLoginWarning[] {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const subscriptions = useClaudeSubscriptions(teamId, live);
  const coordinatorUsesIt =
    coordinatorProviderOf(useRoutingSettings(teamId, live).data) === 'claude-code';
  return (subscriptions.data ?? []).flatMap((connection) => {
    const text = subscriptionLoginWarning(connection, now, t, coordinatorUsesIt);
    return text === null
      ? []
      : [
          {
            key: connection.id,
            kind: expiryWarningKind(connection.expiresAt, now),
            text,
            subscriptionId: connection.id,
            label: connection.label,
          },
        ];
  });
}

export function ClaudeLoginBanner({ warnings }: { warnings: readonly ClaudeLoginWarning[] }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const client = useQueryClient();
  const createSubscription = useCreateClaudeSubscription(teamId);
  const [reloginOpen, setReloginOpen] = useState(false);

  const primary = warnings.find((warning) => warning.kind === 'expired') ?? warnings[0];

  return (
    <>
      <SubscriptionLoginBanner
        testIdPrefix="claude"
        warnings={warnings}
        singleTitle={t('Claude 登录需要处理')}
        onSignInAgain={primary === undefined ? undefined : () => setReloginOpen(true)}
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
      {reloginOpen && primary !== undefined && (
        <AddClaudeSubscriptionDialog
          reloginTarget={{ id: primary.subscriptionId, label: primary.label }}
          onClose={() => {
            createSubscription.reset();
            setReloginOpen(false);
          }}
          onCreate={(body) =>
            createSubscription.mutate(body, {
              onSuccess: () => {
                createSubscription.reset();
                setReloginOpen(false);
                void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
                void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
              },
            })
          }
          pending={createSubscription.isPending}
          error={createSubscription.isError}
        />
      )}
    </>
  );
}

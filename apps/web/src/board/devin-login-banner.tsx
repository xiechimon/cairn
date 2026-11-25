import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCreateDevinSubscription, useDevinSubscriptions } from '../api/devin-subscriptions.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { devinSubscriptionLoginWarning } from '../devin-login-warning.js';
import { useI18n } from '../i18n/provider.js';
import { AddDevinSubscriptionDialog } from '../resources/devin-subscriptions.js';
import {
  expiryWarningKind,
  SubscriptionLoginBanner,
  type SubscriptionLoginWarning,
} from './subscription-login-banner.js';

export type DevinLoginWarning = SubscriptionLoginWarning<'expired' | 'expiring'> & {
  subscriptionId: string;
  label: string;
};

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
            kind: expiryWarningKind(subscription.expiresAt, now),
            text,
            subscriptionId: subscription.id,
            label: subscription.label,
          },
        ];
  });
}

export function DevinLoginBanner({ warnings }: { warnings: readonly DevinLoginWarning[] }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const client = useQueryClient();
  const createSubscription = useCreateDevinSubscription(teamId);
  const [reloginOpen, setReloginOpen] = useState(false);

  const primary = warnings.find((warning) => warning.kind === 'expired') ?? warnings[0];

  const finishRelogin = () => {
    createSubscription.reset();
    setReloginOpen(false);
    void client.invalidateQueries({ queryKey: ['devin-subscriptions', teamId] });
    void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
    void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
  };

  return (
    <>
      <SubscriptionLoginBanner
        testIdPrefix="devin"
        warnings={warnings}
        singleTitle={t('Devin 登录需要处理')}
        onSignInAgain={primary === undefined ? undefined : () => setReloginOpen(true)}
        summary={(items) => {
          const expired = items.filter((warning) => warning.kind === 'expired').length;
          const expiring = items.length - expired;
          return {
            title:
              expiring === 0
                ? t('{count} 处 Devin 登录已过期', { count: expired })
                : expired === 0
                  ? t('{count} 处 Devin 登录即将过期', { count: expiring })
                  : t('{expired} 处已过期，{expiring} 处即将过期', { expired, expiring }),
            body:
              expired === 0
                ? t('到期前换上新的 token，任务才不会中断。')
                : t('换上新的 token 之前，这些订阅不会接新任务。'),
          };
        }}
      />
      {reloginOpen && primary !== undefined && (
        <AddDevinSubscriptionDialog
          teamId={teamId}
          reloginTarget={{ id: primary.subscriptionId, label: primary.label }}
          onLocalCreated={() => finishRelogin()}
          onClose={() => {
            createSubscription.reset();
            setReloginOpen(false);
          }}
          onCreate={(body) =>
            createSubscription.mutate(body, {
              onSuccess: () => finishRelogin(),
            })
          }
          pending={createSubscription.isPending}
          error={createSubscription.isError}
        />
      )}
    </>
  );
}

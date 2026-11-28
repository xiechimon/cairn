import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useCreateAntigravitySubscription } from '../api/antigravity-subscriptions.js';
import { useCreateClaudeSubscription } from '../api/claude-subscriptions.js';
import { useCreateDevinSubscription } from '../api/devin-subscriptions.js';
import { useCreateDoubaoSubscription } from '../api/doubao-subscriptions.js';
import { useApiMutations, useCapabilities } from '../api/hooks.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { describeError } from '../lib/error-copy.js';
import {
  AddAntigravitySubscriptionDialog,
  AntigravityReloginDialog,
  type AntigravityReloginTarget,
} from './antigravity-subscriptions.js';
import { AddClaudeSubscriptionDialog } from './claude-subscriptions.js';
import type { CreateProviderDialog as CreateProviderDialogModule } from './create-provider-dialog.js';
import { type DeviceSignInKind, useDeviceSignIn } from './device-sign-in.js';
import { AddDevinSubscriptionDialog } from './devin-subscriptions.js';
import { AddDoubaoSubscriptionDialog } from './doubao-subscriptions.js';

export type AddProviderView =
  | 'closed'
  | 'picker'
  | 'codex-sign-in'
  | 'subscription'
  | 'devin-subscription'
  | 'antigravity-subscription'
  | 'doubao-subscription';

export type CreatedSubscription = { id: string; label: string };

export type SubscriptionSource = 'claude' | 'devin' | 'antigravity' | 'doubao';

export type SubscriptionRelogin =
  | { source: 'claude'; id: string; label: string }
  | { source: 'devin'; id: string; label: string }
  | ({ source: 'antigravity' } & AntigravityReloginTarget);

export function AddProviderFlow({
  teamId,
  live,
  view,
  onViewChange,
  connectError,
  onConnectError,
  onSubscriptionCreated,
  relogin = null,
  inline = false,
  testId,
  lead,
}: {
  teamId: string | undefined;
  live: boolean;
  view: AddProviderView;
  onViewChange: (view: AddProviderView) => void;
  connectError: string | null;
  onConnectError: (message: string | null) => void;
  onSubscriptionCreated?: (created: CreatedSubscription, source: SubscriptionSource) => void;
  relogin?: SubscriptionRelogin | null;
  inline?: boolean;
  testId?: string;
  lead?: ReactNode;
}) {
  const { t } = useI18n();
  const added = () => toastSuccess(t('已添加服务商'));
  const mutations = useApiMutations(teamId);
  const client = useQueryClient();
  const createSubscription = useCreateClaudeSubscription(teamId);
  const createDevinSubscription = useCreateDevinSubscription(teamId);
  const createAntigravitySubscription = useCreateAntigravitySubscription(teamId);
  const createDoubaoSubscription = useCreateDoubaoSubscription(teamId);
  const capabilities = useCapabilities(live);
  const [CreateProviderDialog, setCreateProviderDialog] = useState<
    typeof CreateProviderDialogModule | null
  >(null);
  const pickerOpen = inline || view === 'picker' || view === 'codex-sign-in';
  const [picked, setPicked] = useState<DeviceSignInKind | null>(null);
  const signInKind: DeviceSignInKind | null = !live
    ? null
    : view === 'codex-sign-in'
      ? 'codex'
      : pickerOpen
        ? picked
        : null;
  const signIn = useDeviceSignIn({
    kind: signInKind,
    start: { codex: mutations.startCodexDevice, xai: mutations.startXaiDevice },
    poll: { codex: mutations.pollCodexDevice, xai: mutations.pollXaiDevice },
    onComplete: (created) => {
      if (created) added();
      else toastSuccess(t('已连接服务商'));
      setPicked(null);
      onViewChange('closed');
    },
    onCancel: () => {
      setPicked(null);
      if (view === 'codex-sign-in') onViewChange('closed');
    },
  });

  useEffect(() => {
    let mounted = true;
    void import('./create-provider-dialog.js').then((module) => {
      if (mounted) setCreateProviderDialog(() => module.CreateProviderDialog);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshSubscription = (source: SubscriptionSource) => {
    void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
    if (source !== 'claude') {
      void client.invalidateQueries({ queryKey: [`${source}-subscriptions`, teamId] });
    }
  };
  const closeSubscription = (created: CreatedSubscription, source: SubscriptionSource) => {
    onViewChange('closed');
    onSubscriptionCreated?.(created, source);
  };
  const finishSubscription = (created: CreatedSubscription, source: SubscriptionSource) => {
    if (relogin?.source !== source) added();
    refreshSubscription(source);
    closeSubscription(created, source);
  };

  return (
    <>
      {CreateProviderDialog !== null ? (
        <CreateProviderDialog
          open={pickerOpen}
          inline={inline}
          testId={testId}
          lead={lead}
          onClose={() => {
            onViewChange('closed');
            onConnectError(null);
            setPicked(null);
          }}
          onXaiSignIn={live ? () => setPicked('xai') : undefined}
          onCodexSignIn={live ? () => setPicked('codex') : undefined}
          signIn={signIn}
          pending={mutations.createProvider.isPending}
          onCreate={
            live
              ? (body) =>
                  mutations.createProvider.mutate(body, {
                    onSuccess: () => {
                      added();
                      onViewChange('closed');
                    },
                    onError: (error) => toastError(t('添加服务商失败，请重试。'), error),
                  })
              : undefined
          }
          onConnect={
            live
              ? (presetId) => {
                  onConnectError(null);
                  mutations.startProviderOAuth.mutate(presetId, {
                    onSuccess: (data) => window.location.assign(data.authorizationUrl),
                    onError: (err) =>
                      onConnectError(describeError(err, t) ?? t('无法发起登录，请重试。')),
                  });
                }
              : undefined
          }
          oauthSignIn={live ? capabilities.data?.githubOAuth === true : true}
          connectPending={mutations.startProviderOAuth.isPending}
          connectError={connectError}
          onPickClaudeSubscription={
            live
              ? () => {
                  createSubscription.reset();
                  onViewChange('subscription');
                }
              : undefined
          }
          onPickDevinSubscription={
            live
              ? () => {
                  createDevinSubscription.reset();
                  onViewChange('devin-subscription');
                }
              : undefined
          }
          onPickAntigravitySubscription={
            live
              ? () => {
                  createAntigravitySubscription.reset();
                  onViewChange('antigravity-subscription');
                }
              : undefined
          }
          onPickDoubaoSubscription={
            live
              ? () => {
                  createDoubaoSubscription.reset();
                  onViewChange('doubao-subscription');
                }
              : undefined
          }
        />
      ) : null}
      {view === 'subscription' && (
        <AddClaudeSubscriptionDialog
          {...(relogin?.source === 'claude' ? { reloginTarget: relogin } : {})}
          onClose={() => {
            createSubscription.reset();
            onViewChange('closed');
          }}
          onCreate={(body) =>
            createSubscription.mutate(body, {
              onSuccess: (created) => {
                createSubscription.reset();
                finishSubscription(created, 'claude');
              },
            })
          }
          pending={createSubscription.isPending}
          error={createSubscription.isError}
        />
      )}
      {view === 'devin-subscription' && (
        <AddDevinSubscriptionDialog
          teamId={teamId}
          {...(relogin?.source === 'devin' ? { reloginTarget: relogin } : {})}
          onLocalCreated={(created) => finishSubscription(created, 'devin')}
          onClose={() => {
            createDevinSubscription.reset();
            onViewChange('closed');
          }}
          onCreate={(body) =>
            createDevinSubscription.mutate(body, {
              onSuccess: (created) => {
                createDevinSubscription.reset();
                finishSubscription(created, 'devin');
              },
            })
          }
          pending={createDevinSubscription.isPending}
          error={createDevinSubscription.isError}
        />
      )}
      {view === 'antigravity-subscription' &&
        (relogin?.source === 'antigravity' ? (
          <AntigravityReloginDialog
            teamId={teamId}
            target={relogin}
            onSignedIn={(created) => finishSubscription(created, 'antigravity')}
            onClose={() => onViewChange('closed')}
          />
        ) : (
          <AddAntigravitySubscriptionDialog
            teamId={teamId}
            onLocalCreated={(created) => finishSubscription(created, 'antigravity')}
            onClose={() => {
              createAntigravitySubscription.reset();
              onViewChange('closed');
            }}
            onCreate={(body) =>
              createAntigravitySubscription.mutate(body, {
                onSuccess: (created) => {
                  createAntigravitySubscription.reset();
                  finishSubscription(created, 'antigravity');
                },
              })
            }
            pending={createAntigravitySubscription.isPending}
            error={createAntigravitySubscription.isError}
          />
        ))}
      {view === 'doubao-subscription' && (
        <AddDoubaoSubscriptionDialog
          teamId={teamId}
          onClose={() => {
            createDoubaoSubscription.reset();
            onViewChange('closed');
          }}
          onCreate={(body, onSaved) =>
            createDoubaoSubscription.mutate(body, {
              onSuccess: (created) => {
                createDoubaoSubscription.reset();
                if (onSaved !== undefined) {
                  added();
                  refreshSubscription('doubao');
                  onSaved(created);
                  return;
                }
                finishSubscription(created, 'doubao');
              },
            })
          }
          onFinish={(created) => {
            refreshSubscription('doubao');
            closeSubscription(created, 'doubao');
          }}
          pending={createDoubaoSubscription.isPending}
          error={createDoubaoSubscription.isError}
        />
      )}
    </>
  );
}

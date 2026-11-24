import { type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useCreateAntigravitySubscription } from '../api/antigravity-subscriptions.js';
import { useCreateClaudeSubscription } from '../api/claude-subscriptions.js';
import { useCreateDevinSubscription } from '../api/devin-subscriptions.js';
import { useApiMutations, useCapabilities } from '../api/hooks.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { AddAntigravitySubscriptionDialog } from './antigravity-subscriptions.js';
import { AddClaudeSubscriptionDialog } from './claude-subscriptions.js';
import type { CreateProviderDialog as CreateProviderDialogModule } from './create-provider-dialog.js';
import { AddDevinSubscriptionDialog } from './devin-subscriptions.js';

export type AddProviderView =
  | 'closed'
  | 'picker'
  | 'subscription'
  | 'devin-subscription'
  | 'antigravity-subscription';

export type CreatedSubscription = { id: string; label: string };

export type SubscriptionSource = 'claude' | 'devin' | 'antigravity';

interface DeviceLogin {
  state: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
}

type DevicePoll = UseMutationResult<
  { status: 'pending' | 'complete' | 'superseded' | 'denied' | 'expired' },
  Error,
  string
>;

function useDeviceLogin({
  active,
  poll,
  onComplete,
  messages,
}: {
  active: boolean;
  poll: DevicePoll;
  onComplete: () => void;
  messages: { denied: string; superseded: string; expired: string; failed: string };
}) {
  const [device, setDevice] = useState<DeviceLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!active || device === null) return;
    let stopped = false;
    const timer = setInterval(() => {
      void pollRef.current.mutateAsync(device.state).then(
        (result) => {
          if (stopped || result.status === 'pending') return;
          setDevice(null);
          if (result.status === 'complete') {
            setError(null);
            completeRef.current();
          } else {
            setError(messagesRef.current[result.status]);
          }
        },
        () => {
          if (!stopped) setError(messagesRef.current.failed);
        },
      );
    }, device.intervalSeconds * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, device]);

  return {
    device,
    error,
    reset: () => {
      setDevice(null);
      setError(null);
    },
    begin: (start: UseMutationResult<DeviceLogin, Error, void>) => {
      setError(null);
      start.mutate(undefined, {
        onSuccess: setDevice,
        onError: () => setError(messagesRef.current.failed),
      });
    },
  };
}

export function AddProviderFlow({
  teamId,
  live,
  view,
  onViewChange,
  connectError,
  onConnectError,
  onSubscriptionCreated,
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
  inline?: boolean;
  testId?: string;
  lead?: ReactNode;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const client = useQueryClient();
  const createSubscription = useCreateClaudeSubscription(teamId);
  const createDevinSubscription = useCreateDevinSubscription(teamId);
  const createAntigravitySubscription = useCreateAntigravitySubscription(teamId);
  const capabilities = useCapabilities(live);
  const [CreateProviderDialog, setCreateProviderDialog] = useState<
    typeof CreateProviderDialogModule | null
  >(null);
  const pickerOpen = inline || view === 'picker';
  const xai = useDeviceLogin({
    active: pickerOpen,
    poll: mutations.pollXaiDevice,
    onComplete: () => onViewChange('closed'),
    messages: {
      denied: t('xAI 登录被拒绝。'),
      superseded: t('已有更新的 xAI 凭证，这次登录没有覆盖它。'),
      expired: t('验证码已过期，请重试。'),
      failed: t('xAI 登录失败，请重试。'),
    },
  });
  const codex = useDeviceLogin({
    active: pickerOpen,
    poll: mutations.pollCodexDevice,
    onComplete: () => onViewChange('closed'),
    messages: {
      denied: t('ChatGPT 订阅登录被拒绝。'),
      superseded: t('已有更新的 ChatGPT 订阅凭证，这次登录没有覆盖它。'),
      expired: t('验证码已过期，请重试。'),
      failed: t('ChatGPT 订阅登录失败，请重试。'),
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

  const finishSubscription = (created: CreatedSubscription, source: SubscriptionSource) => {
    onViewChange('closed');
    void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    if (source !== 'claude') {
      void client.invalidateQueries({ queryKey: [`${source}-subscriptions`, teamId] });
    }
    onSubscriptionCreated?.(created, source);
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
            xai.reset();
            codex.reset();
          }}
          onXaiSignIn={live ? () => xai.begin(mutations.startXaiDevice) : undefined}
          xaiSignInPending={mutations.startXaiDevice.isPending}
          xaiDevice={xai.device}
          xaiDeviceError={xai.error}
          onCodexSignIn={live ? () => codex.begin(mutations.startCodexDevice) : undefined}
          codexSignInPending={mutations.startCodexDevice.isPending}
          codexDevice={codex.device}
          codexDeviceError={codex.error}
          pending={mutations.createProvider.isPending}
          onCreate={
            live
              ? (body) =>
                  mutations.createProvider.mutate(body, {
                    onSuccess: () => onViewChange('closed'),
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
                    onError: (err) => onConnectError(err.message),
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
        />
      ) : null}
      {view === 'subscription' && (
        <AddClaudeSubscriptionDialog
          onClose={() => {
            createSubscription.reset();
            onViewChange('closed');
          }}
          onCreate={(body) =>
            createSubscription.mutate(body, {
              onSuccess: (created) => {
                createSubscription.reset();
                onViewChange('closed');
                void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
                onSubscriptionCreated?.(created, 'claude');
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
      {view === 'antigravity-subscription' && (
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
      )}
    </>
  );
}

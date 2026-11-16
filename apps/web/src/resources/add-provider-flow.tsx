import type { ClaudeSubscription } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCreateClaudeSubscription } from '../api/claude-subscriptions.js';
import { useApiMutations, useCapabilities } from '../api/hooks.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { AddClaudeSubscriptionDialog } from './claude-subscriptions.js';
import type { CreateProviderDialog as CreateProviderDialogModule } from './create-provider-dialog.js';

export type AddProviderView = 'closed' | 'picker' | 'subscription';

interface XaiDevice {
  state: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
}

export function AddProviderFlow({
  teamId,
  live,
  view,
  onViewChange,
  connectError,
  onConnectError,
  onSubscriptionCreated,
}: {
  teamId: string | undefined;
  live: boolean;
  view: AddProviderView;
  onViewChange: (view: AddProviderView) => void;
  connectError: string | null;
  onConnectError: (message: string | null) => void;
  onSubscriptionCreated?: (created: ClaudeSubscription) => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const client = useQueryClient();
  const createSubscription = useCreateClaudeSubscription(teamId);
  const capabilities = useCapabilities(live);
  const [CreateProviderDialog, setCreateProviderDialog] = useState<
    typeof CreateProviderDialogModule | null
  >(null);
  const [xaiDevice, setXaiDevice] = useState<XaiDevice | null>(null);
  const [xaiDeviceError, setXaiDeviceError] = useState<string | null>(null);
  const pollXai = useRef(mutations.pollXaiDevice);
  pollXai.current = mutations.pollXaiDevice;
  const pickerOpen = view === 'picker';

  useEffect(() => {
    let mounted = true;
    void import('./create-provider-dialog.js').then((module) => {
      if (mounted) setCreateProviderDialog(() => module.CreateProviderDialog);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen || xaiDevice === null) return;
    let stopped = false;
    const timer = setInterval(() => {
      void pollXai.current.mutateAsync(xaiDevice.state).then(
        (result) => {
          if (stopped) return;
          if (result.status === 'complete') {
            setXaiDevice(null);
            setXaiDeviceError(null);
            onViewChange('closed');
            return;
          }
          if (result.status === 'denied') {
            setXaiDevice(null);
            setXaiDeviceError(t('xAI 登录被拒绝。'));
          } else if (result.status === 'superseded') {
            setXaiDevice(null);
            setXaiDeviceError(t('已有更新的 xAI 凭证，这次登录没有覆盖它。'));
          } else if (result.status === 'expired') {
            setXaiDevice(null);
            setXaiDeviceError(t('验证码已过期，请重试。'));
          }
        },
        () => {
          if (!stopped) setXaiDeviceError(t('xAI 登录失败，请重试。'));
        },
      );
    }, xaiDevice.intervalSeconds * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pickerOpen, t, xaiDevice, onViewChange]);

  return (
    <>
      {CreateProviderDialog !== null ? (
        <CreateProviderDialog
          open={pickerOpen}
          onClose={() => {
            onViewChange('closed');
            onConnectError(null);
            setXaiDevice(null);
            setXaiDeviceError(null);
          }}
          onXaiSignIn={
            live
              ? () => {
                  setXaiDeviceError(null);
                  mutations.startXaiDevice.mutate(undefined, {
                    onSuccess: (started) => setXaiDevice(started),
                    onError: () => setXaiDeviceError(t('xAI 登录失败，请重试。')),
                  });
                }
              : undefined
          }
          xaiSignInPending={mutations.startXaiDevice.isPending}
          xaiDevice={xaiDevice}
          xaiDeviceError={xaiDeviceError}
          pending={mutations.createProvider.isPending}
          onCreate={
            live
              ? (body) =>
                  mutations.createProvider.mutate(body, {
                    onSuccess: () => onViewChange('closed'),
                    onError: (error) => toastError(t('添加模型服务失败，请重试。'), error),
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
                onSubscriptionCreated?.(created);
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

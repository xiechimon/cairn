import type { CodexDevicePollResponse } from '@cairn/shared';
import type { UseMutationResult } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FormActions } from '../components/form-layout.js';
import { SignInView, useCodeCopy } from '../components/sign-in-view.js';
import { useI18n } from '../i18n/provider.js';
import { markErrorSurfaced } from '../lib/mutation-error-report.js';

export type DeviceSignInKind = 'codex' | 'xai';

interface DeviceLogin {
  state: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
}

type DevicePollStatus = 'pending' | 'complete' | 'superseded' | 'denied' | 'expired';

type DeviceStart = UseMutationResult<DeviceLogin, Error, void>;
type DevicePoll = UseMutationResult<CodexDevicePollResponse, Error, string>;

type Phase =
  | { step: 'starting' }
  | { step: 'waiting'; device: DeviceLogin }
  | { step: 'failed'; device: DeviceLogin | null; message: string };

export interface SignInParts {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  onCancel: () => void;
}

export function useDeviceSignIn({
  kind,
  start,
  poll,
  onComplete,
  onCancel,
}: {
  kind: DeviceSignInKind | null;
  start: Record<DeviceSignInKind, DeviceStart>;
  poll: Record<DeviceSignInKind, DevicePoll>;
  onComplete: (created: boolean) => void;
  onCancel: () => void;
}): SignInParts | null {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ step: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ start, poll, onComplete });
  latest.current = { start, poll, onComplete };

  const product = kind === 'xai' ? 'xAI' : 'ChatGPT';
  const endedCopy: Record<Exclude<DevicePollStatus, 'pending' | 'complete'>, string> = {
    denied: t('{product} 登录被拒绝。', { product }),
    superseded: t('已有更新的 {product} 凭证，这次登录没有覆盖它。', { product }),
    expired: t('验证码已过期，请重新开始。'),
  };
  const endedRef = useRef(endedCopy);
  endedRef.current = endedCopy;
  const lostCopy = t('登录已过期，请重新开始');
  const startFailedCopy = t('获取验证码失败，请重新开始。');
  const copyRef = useRef({ lostCopy, startFailedCopy });
  copyRef.current = { lostCopy, startFailedCopy };
  const generation = useRef(0);
  const cancel = () => {
    generation.current += 1;
    setPhase({ step: 'starting' });
    onCancel();
  };

  useEffect(() => {
    if (kind === null) return;
    generation.current += 1;
    const mine = generation.current;
    const current = () => generation.current === mine;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (device: DeviceLogin | null, message: string) => {
      if (current()) setPhase({ step: 'failed', device, message });
    };
    const wait = (device: DeviceLogin) => {
      timer = setTimeout(() => {
        if (!current()) return;
        latest.current.poll[kind].mutateAsync(device.state).then(
          (result) => {
            if (!current()) return;
            if (result.status === 'pending') wait(device);
            else if (result.status === 'complete') {
              setPhase({ step: 'starting' });
              latest.current.onComplete(result.created === true);
            } else fail(device, endedRef.current[result.status]);
          },
          (error: unknown) => {
            markErrorSurfaced(error);
            fail(device, copyRef.current.lostCopy);
          },
        );
      }, device.intervalSeconds * 1000);
    };
    setPhase({ step: 'starting' });
    latest.current.start[kind].mutateAsync().then(
      (device) => {
        if (!current()) return;
        setPhase({ step: 'waiting', device });
        wait(device);
      },
      (error: unknown) => {
        markErrorSurfaced(error);
        fail(null, copyRef.current.startFailedCopy);
      },
    );
    return () => {
      if (current()) generation.current += 1;
      clearTimeout(timer);
    };
  }, [kind, attempt]);

  const device = phase.step === 'starting' ? null : phase.device;
  const failed = phase.step === 'failed';
  const clipboard = useCodeCopy(kind !== null && !failed ? (device?.userCode ?? null) : null, true);
  if (kind === null) return null;
  return {
    title: t('登录 {product}', { product }),
    onCancel: cancel,
    body: (
      <SignInView
        testId="device-sign-in"
        instruction={t('打开登录页，输入下面的验证码。')}
        code={
          device === null
            ? failed
              ? undefined
              : 'loading'
            : { value: device.userCode, expired: failed, clipboard }
        }
        waiting={
          phase.step === 'starting'
            ? t('正在获取验证码…')
            : phase.step === 'waiting'
              ? t('正在等你在浏览器里完成登录…')
              : null
        }
        failure={failed ? phase.message : null}
      />
    ),
    footer: (
      <FormActions
        className="pt-0"
        secondary={{ label: t('取消'), onClick: cancel }}
        primary={
          failed
            ? {
                label: t('重新开始'),
                testId: 'device-sign-in-restart',
                onClick: () => {
                  generation.current += 1;
                  setPhase({ step: 'starting' });
                  setAttempt((n) => n + 1);
                },
              }
            : {
                label: t('打开登录页'),
                testId: 'device-sign-in-open',
                disabled: device === null,
                onClick: () => {
                  if (device === null) return;
                  clipboard.copy(false);
                  window.open(device.verificationUri, '_blank', 'noopener,noreferrer');
                },
              }
        }
      />
    ),
  };
}

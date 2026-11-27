import type { ImPlatform, PairRequestSource } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../api/auth.js';
import {
  useImMutations,
  useImPairingRequests,
  usePairingRequests,
  useRemoteMutations,
  useTeams,
} from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

const APPROVE_ARM_DELAY_MS = 1_500;

export function imPlatformLabel(platform: ImPlatform, t: (key: string) => string): string {
  switch (platform) {
    case 'wechat':
      return t('微信');
    case 'slack':
      return 'Slack';
    case 'imessage':
      return 'iMessage';
    case 'telegram':
      return 'Telegram';
  }
}

function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function pairRequestSourceLabel(
  source: PairRequestSource,
  t: (key: string) => string,
): string {
  switch (source) {
    case 'loopback':
      return t('这台电脑');
    case 'lan':
      return t('局域网');
    case 'tailnet':
      return t('Tailscale');
    case 'public':
      return t('外部网络');
    default:
      return t('不明');
  }
}

export function PairingRequestBanner() {
  const { t } = useI18n();
  const auth = useAuth();
  const hasFixtureScenario =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('scenario');
  const enabled = !DEMO_MODE && !auth.gateOpen && !hasFixtureScenario;
  const requestsQ = usePairingRequests(enabled);
  const teamsQ = useTeams(enabled);
  const teamId = Array.isArray(teamsQ.data) ? teamsQ.data[0]?.id : undefined;
  const imRequestsQ = useImPairingRequests(teamId, enabled);
  const mutations = useRemoteMutations();
  const imMutations = useImMutations(teamId);
  const pending = Array.isArray(requestsQ.data) ? requestsQ.data[0] : undefined;
  const pendingId = pending?.id;
  const imRequests = imRequestsQ.data?.requests;
  const pendingIm = Array.isArray(imRequests)
    ? imRequests.find((request) => request.status === 'pending')
    : undefined;
  const pendingImId = pendingIm?.id;
  const [armedId, setArmedId] = useState<string | null>(null);
  const [armedImId, setArmedImId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingId === undefined) {
      setArmedId(null);
      return;
    }
    setArmedId(null);
    const timer = window.setTimeout(() => setArmedId(pendingId), APPROVE_ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pendingId]);

  useEffect(() => {
    if (pendingImId === undefined) {
      setArmedImId(null);
      return;
    }
    setArmedImId(null);
    const timer = window.setTimeout(() => setArmedImId(pendingImId), APPROVE_ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pendingImId]);

  if (!enabled || (pending === undefined && pendingIm === undefined)) return null;

  const approveArmed = pending !== undefined && armedId === pending.id;
  const imApproveArmed = pendingIm !== undefined && armedImId === pendingIm.id;
  const decide = (decision: 'approve' | 'deny') => {
    if (pending === undefined || (decision === 'approve' && !approveArmed)) return;
    mutations.decidePairRequest.mutate(
      { id: pending.id, decision },
      {
        onSuccess: () => {
          toastSuccess(decision === 'approve' ? t('已批准配对') : t('已拒绝配对'));
        },
        onError: (error) => toastError(t('处理配对请求失败，请重试。'), error),
      },
    );
  };

  const decideIm = (decision: 'approved' | 'rejected') => {
    if (pendingIm === undefined || (decision === 'approved' && !imApproveArmed)) return;
    imMutations.decidePairing.mutate(
      { id: pendingIm.id, decision },
      {
        onSuccess: () => {
          toastSuccess(decision === 'approved' ? t('已批准配对') : t('已拒绝配对'));
        },
        onError: (error) => toastError(t('处理配对请求失败，请重试。'), error),
      },
    );
  };

  const banner = (
    <div className="pointer-events-none fixed top-[calc(1rem+var(--titlebar-safe-top))] right-4 z-(--z-gate) flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2.5">
      {pending !== undefined && (
        <div
          data-testid="pairing-request-banner"
          role="status"
          className="desktop-titlebar-no-drag pointer-events-auto flex flex-col gap-2.5 rounded-(--radius-card) bg-popover p-4 shadow-(--e2) ring-1 ring-border"
        >
          <div className="flex flex-col gap-0.5">
            <p className="m-0 text-ui font-medium text-foreground">{t('有新设备请求配对')}</p>
            <p className="m-0 min-w-0 break-words text-meta text-content-secondary">
              {pending.name}
              {pending.source ? ` · ${pairRequestSourceLabel(pending.source, t)}` : ''}
              {pending.detail ? ` · ${pending.detail}` : ''}
            </p>
          </div>
          <div
            data-testid="pairing-request-banner-code"
            className="rounded-md bg-card py-1.5 text-center font-mono text-heading font-semibold text-foreground tabular-nums"
          >
            {formatCode(pending.code)}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="pointer-coarse:h-11"
              data-testid="pairing-banner-deny"
              disabled={mutations.decidePairRequest.isPending}
              onClick={() => decide('deny')}
            >
              {t('拒绝')}
            </Button>
            <Button
              size="sm"
              className="pointer-coarse:h-11"
              data-testid="pairing-banner-approve"
              disabled={mutations.decidePairRequest.isPending || !approveArmed}
              onClick={() => decide('approve')}
            >
              {t('批准')}
            </Button>
          </div>
        </div>
      )}
      {pendingIm !== undefined && (
        <div
          data-testid="im-pairing-request-banner"
          role="status"
          className="desktop-titlebar-no-drag pointer-events-auto flex flex-col gap-2.5 rounded-(--radius-card) bg-popover p-4 shadow-(--e2) ring-1 ring-border"
        >
          <div className="flex flex-col gap-0.5">
            <p className="m-0 text-ui font-medium text-foreground">{t('有新的聊天配对请求')}</p>
            <p className="m-0 min-w-0 break-words text-meta text-content-secondary">
              {imPlatformLabel(pendingIm.platform, t)} ·{' '}
              {pendingIm.senderName ?? pendingIm.senderId}
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="pointer-coarse:h-11"
              data-testid="im-pairing-banner-reject"
              disabled={imMutations.decidePairing.isPending}
              onClick={() => decideIm('rejected')}
            >
              {t('拒绝')}
            </Button>
            <Button
              size="sm"
              className="pointer-coarse:h-11"
              data-testid="im-pairing-banner-approve"
              disabled={imMutations.decidePairing.isPending || !imApproveArmed}
              onClick={() => decideIm('approved')}
            >
              {t('批准')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document !== 'undefined' && document.body !== null) {
    return createPortal(banner, document.body);
  }
  return banner;
}

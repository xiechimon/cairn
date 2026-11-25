import type { PairRequestSource } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../api/auth.js';
import { usePairingRequests, useRemoteMutations } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

const APPROVE_ARM_DELAY_MS = 1_500;

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
  const mutations = useRemoteMutations();
  const pending = requestsQ.data?.[0];
  const pendingId = pending?.id;
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingId === undefined) {
      setArmedId(null);
      return;
    }
    setArmedId(null);
    const timer = window.setTimeout(() => setArmedId(pendingId), APPROVE_ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pendingId]);

  if (!enabled || pending === undefined) return null;

  const approveArmed = armedId === pending.id;
  const decide = (decision: 'approve' | 'deny') => {
    if (decision === 'approve' && !approveArmed) return;
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

  const banner = (
    <div
      data-testid="pairing-request-banner"
      role="status"
      className="pointer-events-auto fixed top-4 right-4 z-(--z-gate) flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2.5 rounded-(--radius-card) bg-popover p-4 shadow-(--e2) ring-1 ring-border"
    >
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-ui font-medium text-foreground">{t('有新设备请求配对')}</p>
        <p className="m-0 text-meta text-content-secondary">
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
  );

  if (typeof document !== 'undefined' && document.body !== null) {
    return createPortal(banner, document.body);
  }
  return banner;
}

import { cn } from 'cn';
import { useEffect } from 'react';
import {
  consumePairFragment,
  ensurePairRequest,
  requestNewPairAttempt,
  useAuth,
} from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useIntervalNow } from '../hooks/use-interval-now.js';
import { useI18n } from '../i18n/provider.js';

function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

const stayOpen = () => undefined;

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const pending = auth.pair?.phase === 'pending';
  const now = useIntervalNow(pending);

  useEffect(() => {
    void consumePairFragment();
  }, []);

  useEffect(() => {
    if (auth.gateOpen && !auth.pairing && !auth.retrying) ensurePairRequest();
  }, [auth.gateOpen, auth.pairing, auth.retrying]);

  if (!auth.gateOpen) return null;
  const pair = auth.pair;
  const terminal = pair !== null && pair.phase !== 'requesting' && pair.phase !== 'pending';
  const remainingMs = pair?.expiresAt == null ? null : Math.max(0, pair.expiresAt - now);
  const remaining =
    remainingMs === null
      ? null
      : `${Math.floor(remainingMs / 60_000)}:${String(
          Math.floor((remainingMs % 60_000) / 1_000),
        ).padStart(2, '0')}`;

  return (
    <DialogShell
      bare
      open
      dismissible={false}
      onClose={stayOpen}
      onBackdropClick={stayOpen}
      zIndex="var(--z-gate)"
      title={t('配对这台电脑')}
      width="100vw"
      height="100dvh"
      className="inset-0! top-0! left-0! max-h-none! translate-x-0! translate-y-0! animate-none! items-center justify-center rounded-none! bg-background! shadow-none! duration-0!"
    >
      <div className="token-gate flex w-90 max-w-[calc(100vw-48px)] flex-col gap-3 rounded-(--radius-sheet) bg-card p-6 shadow-(--e2) ring-1 ring-border">
        <h1 className="token-gate-title m-0 text-heading font-semibold text-foreground">
          {t('配对这台电脑')}
        </h1>
        <p
          className="m-0 text-meta leading-normal text-content-secondary"
          data-testid={
            terminal
              ? pair.phase === 'denied'
                ? 'pair-request-denied'
                : pair.phase === 'expired'
                  ? 'pair-request-expired'
                  : 'pair-request-unavailable'
              : undefined
          }
        >
          {terminal
            ? pair.phase === 'denied'
              ? t('那台电脑拒绝了这次配对。')
              : pair.phase === 'expired'
                ? t('5 分钟内没有人批准，这个码已过期。')
                : t('配对请求发送失败，请重试。')
            : t('在已经能用 Cairn 的电脑上打开「远程访问」，看到这个码就点「批准」。')}
        </p>
        {pair?.code != null && (
          <div
            data-testid="pair-request-code"
            className={cn(
              'py-2 text-center font-mono text-2xl font-semibold text-foreground tabular-nums select-none',
              pair.phase === 'denied' && 'text-content-tertiary line-through',
              pair.phase === 'expired' && 'text-content-tertiary',
            )}
          >
            {formatCode(pair.code)}
          </div>
        )}
        {terminal ? (
          <Button
            className="rounded-md border-0 px-3 text-meta font-normal"
            data-testid="pair-request-retry"
            onClick={() => requestNewPairAttempt()}
          >
            {pair.phase === 'unavailable' ? t('重新发送') : t('换一个码')}
          </Button>
        ) : (
          <p
            className="m-0 flex items-center justify-center gap-2 text-center text-meta text-content-tertiary"
            role="status"
          >
            <RingSpinner aria-hidden="true" className="size-4" />
            {auth.pairing
              ? t('正在配对…')
              : pair?.phase === 'pending' && remaining !== null
                ? t('等待批准 · {remaining} 后失效', { remaining })
                : t('正在发送配对请求…')}
          </p>
        )}
        {auth.rejected && (
          <p className="m-0 text-xs text-destructive" role="alert">
            {t('配对链接无效或已过期。')}
          </p>
        )}
        <p className="m-0 text-center text-caption leading-normal text-content-tertiary">
          <span className="block" role="status">
            {auth.retrying ? t('正在连接…') : null}
          </span>
          {t('服务器地址 {host} · 令牌只发一次，存在这台设备的浏览器里', {
            host: window.location.host,
          })}
        </p>
      </div>
    </DialogShell>
  );
}

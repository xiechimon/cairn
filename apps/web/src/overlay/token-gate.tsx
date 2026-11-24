import { cn } from 'cn';
import { useEffect, useState } from 'react';
import {
  consumePairFragment,
  ensurePairRequest,
  requestNewPairAttempt,
  useAuth,
} from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useI18n } from '../i18n/provider.js';

function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const pending = auth.pair?.phase === 'pending';

  useEffect(() => {
    void consumePairFragment();
  }, []);

  useEffect(() => {
    if (auth.gateOpen && !auth.pairing && !auth.retrying) ensurePairRequest();
  }, [auth.gateOpen, auth.pairing, auth.retrying]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [pending]);

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
    <div className="fixed inset-0 z-(--z-gate) flex items-center justify-center bg-background">
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={t('配对这台电脑')}
        className="token-gate w-[360px] max-w-[calc(100vw-48px)] rounded-(--cds-radius-xl) p-6 shadow-lg"
      >
        <div className="flex flex-col gap-3">
          <h1 className="token-gate-title text-base font-semibold text-foreground">
            {t('配对这台电脑')}
          </h1>
          <p
            className="text-[13px] leading-normal text-content-secondary"
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
              className="border-0 rounded-md px-3 text-[13px] font-normal"
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
            <p className="text-xs text-destructive" role="alert">
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
      </Card>
    </div>
  );
}

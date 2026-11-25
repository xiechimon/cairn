import type { ClerkAuthConfigResponse } from '@cairn/shared';
import { cn } from 'cn';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  consumePairFragment,
  ensurePairRequest,
  fetchClerkAuthConfig,
  requestNewPairAttempt,
  signInWithClerkToken,
  signInWithOwnerToken,
  useAuth,
} from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { Separator } from '../components/ui/separator.js';
import { useIntervalNow } from '../hooks/use-interval-now.js';
import { useI18n } from '../i18n/provider.js';
import { type ClerkBrowserGlobal, loadClerkScript } from '../lib/clerk-loader.js';

function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

const stayOpen = () => undefined;

type ClerkPhase = 'loading' | 'ready' | 'exchanging' | 'not-allowed' | 'invalid' | 'unavailable';

function ClerkSignInCard({
  config,
  onUseFallback,
}: {
  config: ClerkAuthConfigResponse;
  onUseFallback: () => void;
}) {
  const { t } = useI18n();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const exchangingRef = useRef(false);
  const [phase, setPhase] = useState<ClerkPhase>('loading');
  const [attempt, setAttempt] = useState(0);

  const exchangeSession = useCallback(async (clerk: ClerkBrowserGlobal) => {
    if (exchangingRef.current || clerk.session === null) return;
    exchangingRef.current = true;
    setPhase('exchanging');
    try {
      const token = await clerk.session.getToken();
      if (token === null || token === '') {
        setPhase('invalid');
        return;
      }
      const outcome = await signInWithClerkToken(token);
      if (outcome !== 'ok') setPhase(outcome);
    } catch {
      setPhase('unavailable');
    } finally {
      exchangingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!config.enabled || config.issuer === null || config.publishableKey === null) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    const node = mountRef.current;

    setPhase('loading');
    void (async () => {
      try {
        const clerk = await loadClerkScript(
          config.issuer as string,
          config.publishableKey as string,
        );
        await clerk.load();
        if (!active) return;
        if (clerk.user !== null && clerk.session !== null) {
          await exchangeSession(clerk);
          return;
        }
        setPhase('ready');
        if (node !== null) clerk.mountSignIn(node);
        unsubscribe = clerk.addListener(() => {
          if (active && clerk.user !== null && clerk.session !== null) {
            void exchangeSession(clerk);
          }
        });
      } catch {
        if (active) setPhase('unavailable');
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
      if (node !== null && window.Clerk !== undefined) {
        try {
          window.Clerk.unmountSignIn(node);
        } catch {}
      }
    };
  }, [config.enabled, config.issuer, config.publishableKey, attempt, exchangeSession]);

  const switchAccount = async () => {
    try {
      await window.Clerk?.signOut();
    } catch {}
    setAttempt((n) => n + 1);
  };

  return (
    <div
      className="token-gate flex w-104 max-w-[calc(100vw-48px)] flex-col gap-3 rounded-(--radius-sheet) bg-card p-6 shadow-(--e2) ring-1 ring-border"
      data-testid="clerk-sign-in-gate"
    >
      <h1 className="token-gate-title m-0 text-heading font-semibold text-foreground">
        {t('登录 Cairn')}
      </h1>
      <p className="m-0 text-meta leading-normal text-content-secondary">
        {t('使用已授权的账号登录，即可同步访问此实例。')}
      </p>

      {(phase === 'loading' || phase === 'exchanging') && (
        <p
          className="m-0 flex items-center justify-center gap-2 py-4 text-meta text-content-tertiary"
          role="status"
          data-testid="clerk-auth-status"
        >
          <RingSpinner aria-hidden="true" className="size-4" />
          {phase === 'exchanging' ? t('正在验证登录状态…') : t('正在加载登录界面…')}
        </p>
      )}

      {phase === 'not-allowed' && (
        <div className="flex flex-col gap-2" role="alert" data-testid="clerk-auth-not-allowed">
          <p className="m-0 text-meta text-destructive">
            {t('这个账号没有权限访问此实例，请切换账号后重试。')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full pointer-coarse:h-11"
            onClick={() => void switchAccount()}
          >
            {t('切换账号')}
          </Button>
        </div>
      )}

      {(phase === 'unavailable' || phase === 'invalid') && (
        <div className="flex flex-col gap-2" role="alert" data-testid="clerk-auth-error">
          <p className="m-0 text-meta text-destructive">
            {phase === 'unavailable'
              ? t('身份认证服务暂时不可用，请稍后重试。')
              : t('登录状态已失效，请重新登录。')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full pointer-coarse:h-11"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('重试')}
          </Button>
        </div>
      )}

      <div
        ref={mountRef}
        className={cn('flex min-h-0 justify-center overflow-x-auto', phase !== 'ready' && 'hidden')}
      />

      <Separator />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-meta font-normal text-content-secondary pointer-coarse:h-11"
        data-testid="clerk-fallback-toggle"
        onClick={onUseFallback}
      >
        {t('改用配对码或访问令牌')}
      </Button>
      <p className="m-0 text-center text-caption leading-normal text-content-tertiary">
        {t('服务器地址 {host}', { host: window.location.host })}
      </p>
    </div>
  );
}

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [clerkConfig, setClerkConfig] = useState<ClerkAuthConfigResponse | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [tokenMode, setTokenMode] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<
    'invalid' | 'owner-channel-required' | 'unavailable' | null
  >(null);
  const pending = auth.pair?.phase === 'pending';

  const submitOwnerToken = async (event: FormEvent) => {
    event.preventDefault();
    if (tokenSubmitting) return;
    setTokenSubmitting(true);
    setTokenError(null);
    const outcome = await signInWithOwnerToken(tokenInput);
    setTokenSubmitting(false);
    if (outcome === 'ok') {
      setTokenInput('');
      return;
    }
    setTokenError(outcome);
  };
  const now = useIntervalNow(pending);

  useEffect(() => {
    void consumePairFragment();
  }, []);

  useEffect(() => {
    if (!auth.gateOpen) return;
    let active = true;
    void fetchClerkAuthConfig().then((cfg) => {
      if (active) setClerkConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, [auth.gateOpen]);

  const showClerk = clerkConfig?.enabled === true && !useFallback;

  useEffect(() => {
    if (auth.gateOpen && !auth.pairing && !auth.retrying && clerkConfig !== null && !showClerk) {
      ensurePairRequest();
    }
  }, [auth.gateOpen, auth.pairing, auth.retrying, clerkConfig, showClerk]);

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
      title={showClerk ? t('登录 Cairn') : t('配对这台电脑')}
      width="100vw"
      height="100dvh"
      className="inset-0! top-0! left-0! max-h-none! translate-x-0! translate-y-0! animate-none! items-center justify-center rounded-none! bg-background! shadow-none! duration-0!"
    >
      {showClerk && clerkConfig !== null ? (
        <ClerkSignInCard config={clerkConfig} onUseFallback={() => setUseFallback(true)} />
      ) : (
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
              : t(
                  '在已经登录 Cairn 的电脑上，直接点弹出的批准提醒，或打开左下角「设置 → 远程访问」核对下方配对码后点「批准」。',
                )}
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
          <Separator />
          {tokenMode ? (
            <form onSubmit={(e) => void submitOwnerToken(e)} className="flex flex-col gap-2">
              <Input
                type="password"
                autoComplete="current-password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={t('粘贴服务器访问令牌')}
                aria-label={t('服务器访问令牌')}
                data-testid="owner-token-input"
                disabled={tokenSubmitting}
              />
              <p className="m-0 text-caption leading-normal text-content-tertiary">
                {t('在主机终端运行 cairn token，或查看主机 ~/.cairn-server/token 获取令牌。')}
              </p>
              {tokenError !== null && (
                <p
                  className="m-0 text-xs text-destructive"
                  role="alert"
                  data-testid="owner-token-error"
                >
                  {tokenError === 'invalid'
                    ? t('访问令牌无效，请检查后重试。')
                    : tokenError === 'owner-channel-required'
                      ? t('这台主机仅接受其他设备使用配对码登录，请返回使用配对码。')
                      : t('连接失败，请重试。')}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pointer-coarse:h-11"
                  onClick={() => {
                    setTokenMode(false);
                    setTokenError(null);
                  }}
                >
                  {t('返回配对码')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="pointer-coarse:h-11"
                  data-testid="owner-token-submit"
                  disabled={tokenSubmitting || tokenInput.trim() === ''}
                >
                  {tokenSubmitting ? t('正在登录…') : t('登录')}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-meta font-normal text-content-secondary pointer-coarse:h-11"
              data-testid="owner-token-toggle"
              onClick={() => setTokenMode(true)}
            >
              {t('用访问令牌登录')}
            </Button>
          )}
          {clerkConfig?.enabled === true && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-meta font-normal text-content-secondary pointer-coarse:h-11"
              onClick={() => setUseFallback(false)}
            >
              {t('返回账号登录')}
            </Button>
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
      )}
    </DialogShell>
  );
}

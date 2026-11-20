import type { AntigravityLocalStatus, AntigravityLoginOutcome } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import type { CreateAntigravitySubscription } from '../api/antigravity-subscriptions.js';
import { extractAntigravityToken } from '../api/antigravity-subscriptions.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { InfoTip } from '../components/info-tip.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

interface AntigravityBridge {
  status: () => Promise<AntigravityLocalStatus>;
  importKey: () => Promise<{ ok: true; key: string } | { ok: false; reason: string }>;
  login: () => Promise<AntigravityLoginOutcome>;
  cancelLogin: () => Promise<void>;
}

function antigravityBridge(): AntigravityBridge | null {
  const desktop = (window as Window & { cairnDesktop?: { antigravity?: AntigravityBridge } })
    .cairnDesktop;
  return desktop?.antigravity ?? null;
}

function loginFailCopy(reason: string, t: TFunc): string {
  return reason === 'timeout'
    ? t('等待 Antigravity 登录超时，可以再试一次，或改用下方粘贴。')
    : t('Antigravity 登录没有完成，可以再试一次，或改用下方粘贴。');
}

export function AddAntigravitySubscriptionDialog({
  onClose,
  onCreate,
  pending,
  error,
}: {
  onClose: () => void;
  onCreate: (body: CreateAntigravitySubscription) => void;
  pending: boolean;
  error: boolean;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(t('Antigravity 订阅'));
  const [token, setToken] = useState('');
  const [bridge] = useState(antigravityBridge);
  const [local, setLocal] = useState<AntigravityLocalStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'failed'>('idle');
  const [failReason, setFailReason] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const submittedRef = useRef(false);
  const waitingRef = useRef(false);

  useEffect(() => {
    if (bridge === null) return;
    let mounted = true;
    void bridge.status().then(
      (status) => {
        if (mounted) setLocal(status);
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, [bridge]);

  useEffect(
    () => () => {
      if (waitingRef.current) void bridge?.cancelLogin();
    },
    [bridge],
  );

  useEffect(() => {
    if (!pending) submittedRef.current = false;
  }, [pending]);

  const submit = (value: string | null) => {
    if (pending || submittedRef.current) return;
    submittedRef.current = true;
    onCreate({
      label: label.trim(),
      token: value,
    });
  };

  const importLocal = async () => {
    if (bridge === null) return;
    const outcome = await bridge.importKey();
    submit(outcome.ok ? outcome.key : null);
  };

  const startLogin = async () => {
    if (bridge === null) return;
    setPhase('waiting');
    waitingRef.current = true;
    const outcome = await bridge.login();
    waitingRef.current = false;
    if (outcome.ok) {
      const imported = await bridge.importKey();
      submit(imported.ok ? imported.key : null);
      return;
    }
    if (outcome.reason === 'cancelled') {
      setPhase('idle');
      return;
    }
    setFailReason(outcome.reason);
    setPhase('failed');
  };

  const localAction =
    local !== null && (local.loggedIn || local.canLogin) ? (
      phase === 'waiting' ? (
        <p className="m-0 flex items-center gap-2">
          <RingSpinner className="size-4" />
          <span className="min-w-0 flex-1">
            {t('已在浏览器中打开 Antigravity 登录页，完成后会自动继续。')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="antigravity-local-login-cancel"
            onClick={() => void bridge?.cancelLogin()}
          >
            {t('取消')}
          </Button>
        </p>
      ) : local.loggedIn ? (
        <p className="m-0 flex items-center gap-2">
          <span className="min-w-0 flex-1">{t('这台 Mac 已登录 Antigravity。')}</span>
          <Button
            variant="outline"
            size="sm"
            data-testid="antigravity-local-import"
            disabled={pending}
            onClick={() => void importLocal()}
          >
            {t('从这台 Mac 接入')}
          </Button>
        </p>
      ) : (
        <p className="m-0 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="antigravity-local-login"
            disabled={pending}
            onClick={() => void startLogin()}
          >
            {t('在这台 Mac 上登录 Antigravity')}
          </Button>
          <span className="min-w-0 flex-1 text-meta text-content-tertiary">
            {t('会打开浏览器完成 Google 账号登录。')}
          </span>
        </p>
      )
    ) : null;

  return (
    <DialogShell
      title={t('添加 Antigravity 订阅')}
      open
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('保存'),
            disabled:
              pending || !label.trim() || phase === 'waiting' || (pasteOpen && !token.trim()),
            onClick: () => submit(pasteOpen ? extractAntigravityToken(token) : null),
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        {localAction}
        {phase === 'failed' && (
          <p role="alert" className="m-0 text-meta text-content-tertiary">
            {loginFailCopy(failReason, t)}
          </p>
        )}
        {!pasteOpen && (
          <p className="m-0 text-meta text-content-tertiary">
            {withCodeSpans(
              t('默认使用执行机已登录的 Antigravity，也可以展开下方粘贴 `GEMINI_API_KEY`。'),
            )}{' '}
            <InfoTip info={t('登录信息在执行机的 OS 钥匙串里')} />
          </p>
        )}
        <FormField label={t('名称')} htmlFor="antigravity-subscription-label">
          <Input
            className={FORM_CONTROL_CLS}
            id="antigravity-subscription-label"
            data-testid="antigravity-subscription-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        {!pasteOpen ? (
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            data-testid="antigravity-paste-toggle"
            onClick={() => setPasteOpen(true)}
          >
            {t('也可以粘贴 API Key')}
          </Button>
        ) : (
          <>
            <p className="m-0 text-meta text-content-tertiary">
              {withCodeSpans(t('粘贴 `GEMINI_API_KEY` 或 `.env` 片段。保存后无法再查看。'))}{' '}
              <InfoTip info={t('Token 加密保存')} />
            </p>
            <FormField label="GEMINI_API_KEY" htmlFor="antigravity-subscription-token">
              <Input
                className={FORM_CONTROL_CLS}
                id="antigravity-subscription-token"
                data-testid="antigravity-subscription-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </FormField>
          </>
        )}
        {error && <p role="alert">{t('保存失败，请检查填写内容后重试。')}</p>}
      </FormStack>
    </DialogShell>
  );
}

import type { DevinLocalStatus, DevinLoginOutcome } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import type { CreateDevinSubscription } from '../api/devin-subscriptions.js';
import { extractDevinToken } from '../api/devin-subscriptions.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Spinner } from '../components/ui/spinner.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

const DEVIN_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

interface DevinBridge {
  status: () => Promise<DevinLocalStatus>;
  importKey: () => Promise<{ ok: true; key: string } | { ok: false; reason: string }>;
  login: () => Promise<DevinLoginOutcome>;
  cancelLogin: () => Promise<void>;
}

function devinBridge(): DevinBridge | null {
  const desktop = (window as Window & { cairnDesktop?: { devin?: DevinBridge } }).cairnDesktop;
  return desktop?.devin ?? null;
}

function loginFailCopy(reason: string, t: TFunc): string {
  return reason === 'timeout'
    ? t('等待 Devin 登录超时，可以再试一次，或改用下方粘贴。')
    : t('Devin 登录没有完成，可以再试一次，或改用下方粘贴。');
}

export function AddDevinSubscriptionDialog({
  onClose,
  onCreate,
  pending,
  error,
}: {
  onClose: () => void;
  onCreate: (body: CreateDevinSubscription) => void;
  pending: boolean;
  error: boolean;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(t('Devin 订阅'));
  const [token, setToken] = useState('');
  const [bridge] = useState(devinBridge);
  const [local, setLocal] = useState<DevinLocalStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'failed' | 'import-failed'>('idle');
  const [failReason, setFailReason] = useState('');
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

  const submit = (value: string) => {
    if (pending || submittedRef.current) return;
    submittedRef.current = true;
    onCreate({
      label: label.trim(),
      token: value,
      expiresAt: Date.now() + DEVIN_TOKEN_LIFETIME_MS,
    });
  };

  const importLocal = async () => {
    if (bridge === null) return;
    const outcome = await bridge.importKey();
    if (outcome.ok) {
      submit(outcome.key);
      return;
    }
    setFailReason(outcome.reason);
    setPhase('import-failed');
  };

  const startLogin = async () => {
    if (bridge === null) return;
    setPhase('waiting');
    waitingRef.current = true;
    const outcome = await bridge.login();
    waitingRef.current = false;
    if (outcome.ok) {
      submit(outcome.key);
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
          <Spinner className="size-4" />
          <span className="min-w-0 flex-1">
            {t('已在浏览器中打开 Devin 登录页，完成后会自动继续。')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="devin-local-login-cancel"
            onClick={() => void bridge?.cancelLogin()}
          >
            {t('取消')}
          </Button>
        </p>
      ) : local.loggedIn ? (
        <p className="m-0 flex items-center gap-2">
          <span className="min-w-0 flex-1">{t('这台 Mac 已登录 Devin。')}</span>
          <Button
            variant="outline"
            size="sm"
            data-testid="devin-local-import"
            disabled={pending}
            onClick={() => void importLocal()}
          >
            {t('从这台 Mac 导入')}
          </Button>
        </p>
      ) : (
        <p className="m-0 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="devin-local-login"
            disabled={pending}
            onClick={() => void startLogin()}
          >
            {t('在这台 Mac 上登录 Devin')}
          </Button>
          <span className="min-w-0 flex-1 text-meta text-content-tertiary">
            {t('会打开浏览器完成登录。')}
          </span>
        </p>
      )
    ) : null;

  return (
    <DialogShell
      title={t('添加 Devin 订阅')}
      open
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('保存'),
            disabled: pending || !label.trim() || !token.trim(),
            onClick: () => submit(extractDevinToken(token)),
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        {localAction}
        {(phase === 'failed' || phase === 'import-failed') && (
          <p role="alert" className="m-0 text-meta text-content-tertiary">
            {phase === 'import-failed'
              ? t('没有读到这台 Mac 上的 Devin 登录，请改用下方粘贴。')
              : loginFailCopy(failReason, t)}
          </p>
        )}
        <p>
          {withCodeSpans(
            t(
              '在登录过 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把输出整个粘贴到下面，会自动取出 `windsurf_api_key`。',
            ),
          )}
        </p>
        <p>{t('任务会用这个订阅跑 Devin，不用再配 API key。Token 加密保存，保存后无法再查看。')}</p>
        <FormField label={t('名称')} htmlFor="devin-subscription-label">
          <Input
            className={FORM_CONTROL_CLS}
            id="devin-subscription-label"
            data-testid="devin-subscription-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <FormField label="Token" htmlFor="devin-subscription-token">
          <Input
            className={FORM_CONTROL_CLS}
            id="devin-subscription-token"
            data-testid="devin-subscription-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </FormField>
        {error && <p role="alert">{t('保存失败，请检查填写内容后重试。')}</p>}
      </FormStack>
    </DialogShell>
  );
}

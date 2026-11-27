import {
  DEVIN_TOKEN_LIFETIME_MS,
  type DesktopSubscriptionMetadata,
  type DevinLocalStatus,
  type DevinLoginOutcome,
} from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import type { CreateDevinSubscription } from '../api/devin-subscriptions.js';
import { extractDevinToken } from '../api/devin-subscriptions.js';
import { UpdateCairnNotice } from '../board/desktop-update.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { InfoTip } from '../components/info-tip.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { devinBridge, devinCapabilityState } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

function loginFailCopy(reason: string, t: TFunc): string {
  return reason === 'timeout'
    ? t('等待 Devin 登录超时。请重试，或改用下方粘贴。')
    : t('Devin 登录未完成。请重试，或改用下方粘贴。');
}

export function AddDevinSubscriptionDialog({
  teamId,
  onClose,
  onCreate,
  onLocalCreated,
  pending,
  error,
  reloginTarget,
}: {
  teamId: string | undefined;
  onClose: () => void;
  onCreate: (body: CreateDevinSubscription) => void;
  onLocalCreated: (subscription: DesktopSubscriptionMetadata) => void;
  pending: boolean;
  error: boolean;
  reloginTarget?: { id: string; label: string };
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(reloginTarget?.label ?? t('Devin 订阅'));
  const [token, setToken] = useState('');
  const [capability] = useState(devinCapabilityState);
  const [bridge] = useState(devinBridge);
  const [local, setLocal] = useState<DevinLocalStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'failed' | 'import-failed'>('idle');
  const [failReason, setFailReason] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const submittedRef = useRef(false);
  const waitingRef = useRef(false);
  const importingRef = useRef(false);
  const autoStartedRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const busy = pending || importing || phase === 'waiting';

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
    if (busy || waitingRef.current || importingRef.current || submittedRef.current) return;
    submittedRef.current = true;
    onCreate({
      label: label.trim(),
      token: value,
      expiresAt: Date.now() + DEVIN_TOKEN_LIFETIME_MS,
    });
  };

  const importLocal = async () => {
    if (bridge === null || teamId === undefined || !label.trim() || busy || importingRef.current)
      return;
    importingRef.current = true;
    setImporting(true);
    try {
      const outcome = await bridge.import({ teamId, label: label.trim() });
      if (outcome.ok) {
        onLocalCreated(outcome.subscription);
        return;
      }
      setFailReason(outcome.reason);
      setPhase('import-failed');
    } catch {
      setFailReason('save');
      setPhase('import-failed');
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const startLogin = async () => {
    if (bridge === null || teamId === undefined || !label.trim() || busy || waitingRef.current)
      return;
    setPhase('waiting');
    waitingRef.current = true;
    const outcome = await bridge
      .login({ teamId, label: label.trim() })
      .catch((): DevinLoginOutcome => ({ ok: false, reason: 'save' }));
    waitingRef.current = false;
    if (outcome.ok) {
      onLocalCreated(outcome.subscription);
      return;
    }
    if (outcome.reason === 'cancelled') {
      setPhase('idle');
      return;
    }
    setFailReason(outcome.reason);
    setPhase('failed');
  };

  const startLoginRef = useRef(startLogin);
  startLoginRef.current = startLogin;

  useEffect(() => {
    if (
      reloginTarget === undefined ||
      autoStartedRef.current ||
      bridge === null ||
      local === null ||
      !local.canLogin
    ) {
      return;
    }
    autoStartedRef.current = true;
    void startLoginRef.current();
  }, [reloginTarget, bridge, local]);

  const localAction =
    capability === 'needs-update' ? (
      <UpdateCairnNotice message={t('更新 Cairn 后即可在这里直接登录。')} />
    ) : capability === 'allowed' && local !== null && (local.loggedIn || local.canLogin) ? (
      phase === 'waiting' ? (
        <p className="m-0 flex items-center gap-2">
          <RingSpinner className="size-4" />
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
      ) : local.loggedIn && reloginTarget === undefined ? (
        <p className="m-0 flex items-center gap-2">
          <span className="min-w-0 flex-1">{t('这台 Mac 已登录 Devin。')}</span>
          <Button
            variant="outline"
            size="sm"
            data-testid="devin-local-import"
            disabled={busy || !label.trim()}
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
            disabled={busy || !label.trim()}
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
      title={reloginTarget !== undefined ? t('重新登录 Devin') : t('添加 Devin 订阅')}
      open
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('保存'),
            disabled: busy || !label.trim() || !token.trim(),
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
            {failReason === 'save'
              ? t('保存失败，请检查填写内容后重试。')
              : phase === 'import-failed'
                ? t('没有读到这台 Mac 上的 Devin 登录，请改用下方粘贴。')
                : loginFailCopy(failReason, t)}
          </p>
        )}
        {reloginTarget === undefined && (
          <FormField label={t('名称')} htmlFor="devin-subscription-label">
            <Input
              className={FORM_CONTROL_CLS}
              id="devin-subscription-label"
              data-testid="devin-subscription-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
        )}
        {bridge !== null && (local === null || localAction !== null) && !pasteOpen ? (
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            data-testid="devin-paste-toggle"
            onClick={() => setPasteOpen(true)}
          >
            {t('也可以粘贴 token')}
          </Button>
        ) : (
          <>
            <p className="m-0 text-meta text-content-tertiary">
              {withCodeSpans(
                t(
                  '在登录过的电脑上 `cat ~/.local/share/devin/credentials.toml`，输出整段粘贴。保存后无法再查看。',
                ),
              )}{' '}
              <InfoTip info={t('仅提取所需的访问凭据并加密保存')} />
            </p>
            <FormField label="Token" htmlFor="devin-subscription-token">
              <Input
                className={FORM_CONTROL_CLS}
                id="devin-subscription-token"
                data-testid="devin-subscription-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
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

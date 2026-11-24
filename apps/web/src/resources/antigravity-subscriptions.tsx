import type {
  AntigravityLocalStatus,
  AntigravityLoginOutcome,
  AntigravityLoginPhase,
  DesktopSubscriptionInput,
  DesktopSubscriptionMetadata,
} from '@cairn/shared';
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
  import: (input: DesktopSubscriptionInput) => Promise<AntigravityLoginOutcome>;
  login: (
    input: DesktopSubscriptionInput,
    subscriptionId?: string,
  ) => Promise<AntigravityLoginOutcome>;
  cancelLogin: () => Promise<void>;
  onLoginProgress?: (listener: (phase: AntigravityLoginPhase) => void) => () => void;
}

export function antigravityBridge(): AntigravityBridge | null {
  const desktop = (window as Window & { cairnDesktop?: { antigravity?: AntigravityBridge } })
    .cairnDesktop;
  return desktop?.antigravity ?? null;
}

type LoginPhase = 'idle' | 'installing' | 'waiting' | 'failed';

function useAntigravityLogin(bridge: AntigravityBridge | null) {
  const [phase, setPhase] = useState<LoginPhase>('idle');
  const [failReason, setFailReason] = useState('');
  const activeRef = useRef(false);

  useEffect(() => {
    if (bridge?.onLoginProgress === undefined) return;
    return bridge.onLoginProgress((progress) => {
      if (!activeRef.current) return;
      setPhase(progress === 'installing' ? 'installing' : 'waiting');
    });
  }, [bridge]);

  useEffect(
    () => () => {
      if (activeRef.current) void bridge?.cancelLogin();
    },
    [bridge],
  );

  const start = async (
    input: DesktopSubscriptionInput,
    subscriptionId?: string,
  ): Promise<AntigravityLoginOutcome> => {
    if (bridge === null || activeRef.current) return { ok: false, reason: 'busy' };
    activeRef.current = true;
    setPhase('waiting');
    const outcome = await bridge
      .login(input, subscriptionId)
      .catch((): AntigravityLoginOutcome => ({ ok: false, reason: 'failed' }));
    activeRef.current = false;
    if (outcome.ok) {
      setPhase('idle');
      return outcome;
    }
    if (outcome.reason === 'cancelled') {
      setPhase('idle');
      return outcome;
    }
    setFailReason(outcome.reason);
    setPhase('failed');
    return outcome;
  };

  return { phase, failReason, start, cancel: () => void bridge?.cancelLogin() };
}

function loginFailCopy(reason: string, t: TFunc): string {
  switch (reason) {
    case 'no-binary':
      return t('Antigravity 未能安装。请重试，或改用下方粘贴。');
    case 'busy':
      return t('另一个 Antigravity 登录正在进行，结束后请重试。');
    case 'timeout':
      return t('等待 Antigravity 登录超时。请重试，或改用下方粘贴。');
    default:
      return t('Antigravity 登录未完成。请重试，或改用下方粘贴。');
  }
}

function useAntigravityLocalStatus(bridge: AntigravityBridge | null) {
  const [local, setLocal] = useState<AntigravityLocalStatus | null>(null);
  const refresh = () => {
    if (bridge === null) return;
    void bridge.status().then(
      (status) => setLocal(status),
      () => {},
    );
  };
  useEffect(refresh, [bridge]);
  return { local, refresh };
}

export function AddAntigravitySubscriptionDialog({
  teamId,
  onClose,
  onCreate,
  onLocalCreated,
  pending,
  error,
}: {
  teamId: string | undefined;
  onClose: () => void;
  onCreate: (body: CreateAntigravitySubscription) => void;
  onLocalCreated: (subscription: DesktopSubscriptionMetadata) => void;
  pending: boolean;
  error: boolean;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(t('Antigravity 订阅'));
  const [token, setToken] = useState('');
  const [bridge] = useState(antigravityBridge);
  const { local } = useAntigravityLocalStatus(bridge);
  const login = useAntigravityLogin(bridge);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const [importing, setImporting] = useState(false);
  const localActionRef = useRef(false);
  const submittedRef = useRef(false);
  const busy = pending || importing || login.phase === 'waiting' || login.phase === 'installing';

  useEffect(() => {
    if (!pending) submittedRef.current = false;
  }, [pending]);

  const submit = (body: CreateAntigravitySubscription) => {
    if (busy || localActionRef.current || submittedRef.current) return;
    submittedRef.current = true;
    onCreate(body);
  };

  const importLocal = async () => {
    if (bridge === null || teamId === undefined || !label.trim() || busy || localActionRef.current)
      return;
    localActionRef.current = true;
    setImporting(true);
    try {
      const outcome = await bridge.import({ teamId, label: label.trim() });
      setImportFailed(!outcome.ok);
      if (outcome.ok) onLocalCreated(outcome.subscription);
    } catch {
      setImportFailed(true);
    } finally {
      localActionRef.current = false;
      setImporting(false);
    }
  };

  const startLogin = async () => {
    if (bridge === null || teamId === undefined || !label.trim() || busy || localActionRef.current)
      return;
    localActionRef.current = true;
    setImportFailed(false);
    try {
      const outcome = await login.start({ teamId, label: label.trim() });
      if (outcome.ok) onLocalCreated(outcome.subscription);
    } finally {
      localActionRef.current = false;
    }
  };

  const loginActive = login.phase === 'waiting' || login.phase === 'installing';
  const localAction =
    local !== null && (local.loggedIn || local.canLogin) ? (
      loginActive ? (
        <p className="m-0 flex items-center gap-2">
          <RingSpinner className="size-4" />
          <span className="min-w-0 flex-1">
            {login.phase === 'installing'
              ? t('正在下载安装 Antigravity，完成后会打开浏览器登录。')
              : t('已在浏览器中打开 Antigravity 登录页，完成后会自动继续。')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="antigravity-local-login-cancel"
            onClick={login.cancel}
          >
            {t('取消')}
          </Button>
        </p>
      ) : local.loggedIn && !importFailed ? (
        <p className="m-0 flex items-center gap-2">
          <span className="min-w-0 flex-1">{t('这台 Mac 已登录 Antigravity。')}</span>
          <Button
            variant="outline"
            size="sm"
            data-testid="antigravity-local-import"
            disabled={busy || !label.trim()}
            onClick={() => void importLocal()}
          >
            {t('从这台 Mac 接入')}
          </Button>
        </p>
      ) : local.installed ? (
        <p className="m-0 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="antigravity-local-login"
            disabled={busy || !label.trim()}
            onClick={() => void startLogin()}
          >
            {t('在这台 Mac 上登录 Antigravity')}
          </Button>
          <span className="min-w-0 flex-1 text-meta text-content-tertiary">
            {t('会打开浏览器完成 Google 账号登录。')}
          </span>
        </p>
      ) : (
        <p className="m-0 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="antigravity-local-login"
            disabled={busy || !label.trim()}
            onClick={() => void startLogin()}
          >
            {t('安装并登录 Antigravity')}
          </Button>
          <span className="min-w-0 flex-1 text-meta text-content-tertiary">
            {t('会先下载 Antigravity，再打开浏览器完成 Google 账号登录。')}
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
            disabled: busy || !label.trim() || (pasteOpen && !token.trim()),
            onClick: () => {
              if (!pasteOpen && bridge !== null) {
                void importLocal();
                return;
              }
              submit({
                label: label.trim(),
                token: pasteOpen ? extractAntigravityToken(token) : null,
              });
            },
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        {localAction}
        {login.phase === 'failed' && (
          <p role="alert" className="m-0 text-meta text-content-tertiary">
            {loginFailCopy(login.failReason, t)}
          </p>
        )}
        {importFailed && (
          <p role="alert" className="m-0 text-meta text-content-tertiary">
            {t('未能导入登录凭据，请在这台 Mac 上重新登录 Antigravity。')}
          </p>
        )}
        {!pasteOpen && (
          <p className="m-0 text-meta text-content-tertiary">
            {withCodeSpans(
              t('在这台 Mac 上登录后接入该账号，也可以展开下方粘贴 `GEMINI_API_KEY`。'),
            )}{' '}
            <InfoTip info={t('账号访问令牌加密保存，到期后需重新接入')} />
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
            {t('也可以粘贴 API key')}
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

export function AntigravityRelogin({
  teamId,
  subscription,
  renewOAuth,
  onLoggedIn,
}: {
  teamId: string;
  subscription: DesktopSubscriptionMetadata;
  renewOAuth: boolean;
  onLoggedIn: () => void;
}) {
  const { t } = useI18n();
  const [bridge] = useState(antigravityBridge);
  const { local } = useAntigravityLocalStatus(bridge);
  const login = useAntigravityLogin(bridge);

  if (bridge === null || local === null || (!local.installed && !local.canLogin)) {
    return null;
  }
  const loginActive = login.phase === 'waiting' || login.phase === 'installing';
  return (
    <div data-testid="antigravity-relogin" className="-mt-3 flex flex-col gap-1">
      <p className="m-0 flex items-center gap-2">
        {loginActive ? (
          <>
            <RingSpinner className="size-4" />
            <span className="min-w-0 flex-1 text-meta text-content-tertiary">
              {login.phase === 'installing'
                ? t('正在下载安装 Antigravity，完成后会打开浏览器登录。')
                : t('已在浏览器中打开 Antigravity 登录页，完成后会自动继续。')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              data-testid="antigravity-relogin-cancel"
              onClick={login.cancel}
            >
              {t('取消')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              data-testid="antigravity-detail-login"
              onClick={() =>
                void login
                  .start({ teamId, label: subscription.label }, subscription.id)
                  .then((outcome) => {
                    if (outcome.ok) onLoggedIn();
                  })
              }
            >
              {local.installed ? t('在这台 Mac 上登录 Antigravity') : t('安装并登录 Antigravity')}
            </Button>
            <span className="min-w-0 flex-1 text-meta text-content-tertiary">
              {renewOAuth
                ? t('会打开浏览器完成 Google 账号登录。')
                : t('登录完成后会重新验证；如果执行机是另一台电脑，请在那台电脑上登录。')}
            </span>
          </>
        )}
      </p>
      {login.phase === 'failed' && (
        <p role="alert" className="m-0 text-meta text-content-tertiary">
          {loginFailCopy(login.failReason, t)}
        </p>
      )}
    </div>
  );
}

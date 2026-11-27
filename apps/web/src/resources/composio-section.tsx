import type { ComposioAppEntry, ComposioApps, McpConnectorRecord } from '@cairn/shared';
import { Grid2x2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { McpConnectorIcon } from './mcp-connector-icon.js';
import { type IntegrationItem, RowNote } from './parts.js';

const AUTH_POLL_MS = 2_500;
const AUTH_POLL_MAX_ATTEMPTS = 90;

type Translate = (text: string, vars?: Record<string, string | number>) => string;

export type AppsView = 'available' | 'connected';

export interface ComposioAuthWait {
  connectorId: string;
  redirectUrl: string | null;
}

export function safeHttpsUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || !URL.canParse(url)) return null;
  return new URL(url).protocol === 'https:' ? url : null;
}

export function isComposioInvalidKeyError(error: unknown): boolean {
  return error instanceof ApiError && (error.reason === 'invalid_api_key' || error.status === 400);
}

export function ComposioErrorBanner({
  error,
  isFetching,
  onManageKey,
  onRetry,
}: {
  error: unknown;
  isFetching: boolean;
  onManageKey: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const invalidKey = isComposioInvalidKeyError(error);
  return (
    <NoticeBanner
      tone="danger"
      icon={TriangleAlert}
      title={invalidKey ? t('Composio API key 无效') : t('Composio 应用未能加载')}
      body={
        invalidKey
          ? t('已保存的 API key 未被 Composio 接受，其他应用不受影响。请更换或移除 API key。')
          : t('当前无法连接 Composio，其他应用不受影响。请稍后重试，或更换 API key。')
      }
      data-testid="composio-error-banner"
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={onManageKey}
            data-testid="composio-error-manage-key"
          >
            {t('更换或移除 API key')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={onRetry}
            data-testid="composio-error-retry"
          >
            {t('重试')}
          </Button>
        </>
      }
    />
  );
}

export function ComposioAppActions({
  app,
  busy,
  authWait,
  deleting,
  onConnect,
  onAuthorize,
  onCancelAuth,
  onDisconnect,
}: {
  app: ComposioAppEntry;
  busy: string | null;
  authWait: ComposioAuthWait | null;
  deleting: boolean;
  onConnect: (app: ComposioAppEntry) => void;
  onAuthorize: (connector: McpConnectorRecord, reconnect: boolean) => void;
  onCancelAuth: () => void;
  onDisconnect: (connector: McpConnectorRecord) => void;
}) {
  const { t } = useI18n();
  const connector = app.connector;
  const pending = busy === app.slug || busy === connector?.id;
  if (connector === null)
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => onConnect(app)}
        data-testid={`composio-connect-${app.slug}`}
      >
        {pending ? t('正在连接…') : t('接入')}
      </Button>
    );
  const disconnectButton = (variant: 'outline' | 'ghost') => (
    <Button
      variant={variant}
      size="sm"
      disabled={deleting}
      onClick={() => onDisconnect(connector)}
      data-testid={`composio-remove-${app.slug}`}
    >
      {t('断开')}
    </Button>
  );
  const isPolling = authWait?.connectorId === connector.id;
  if (isPolling) {
    const manualUrl = safeHttpsUrl(authWait.redirectUrl);
    return (
      <>
        {manualUrl !== null && (
          <Button
            variant="outline"
            size="sm"
            data-testid={`composio-open-auth-${app.slug}`}
            render={<a href={manualUrl} target="_blank" rel="noopener noreferrer" />}
          >
            {t('打开授权链接')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancelAuth}
          data-testid={`composio-cancel-auth-${app.slug}`}
        >
          {t('取消授权')}
        </Button>
        {disconnectButton('ghost')}
      </>
    );
  }
  if (connector.status === 'needs_auth') {
    const waiting = connector.statusReason === 'authorizing';
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => onAuthorize(connector, false)}
          data-testid={`composio-authorize-${app.slug}`}
        >
          {pending ? t('正在连接…') : waiting ? t('继续授权') : t('授权')}
        </Button>
        {disconnectButton('ghost')}
      </>
    );
  }
  if (connector.status === 'error' || connector.status === 'revoked')
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => onAuthorize(connector, true)}
          data-testid={`composio-reconnect-${app.slug}`}
        >
          {pending ? t('正在连接…') : t('重新连接')}
        </Button>
        {disconnectButton('ghost')}
      </>
    );
  return disconnectButton('outline');
}

function appNote(t: Translate, record: McpConnectorRecord, authorizing: boolean): ReactNode {
  if (authorizing || (record.status === 'needs_auth' && record.statusReason === 'authorizing'))
    return <RowNote>{t('等待授权')}</RowNote>;
  if (record.status === 'needs_auth') return <RowNote>{t('需要授权')}</RowNote>;
  if (record.status === 'revoked') return <RowNote danger>{t('授权已撤销')}</RowNote>;
  if (record.status === 'error') return <RowNote danger>{t('无法连接')}</RowNote>;
  return undefined;
}

function keyError(t: Translate, error: unknown): string {
  if (error instanceof ApiError && error.status === 400)
    return t('这个 API key 未通过检查，请确认完整复制后再保存。');
  return t('未能保存，请稍后重试。');
}

export function ComposioMark() {
  return (
    <span
      aria-hidden
      className="flex size-5 flex-none items-center justify-center text-content-secondary"
    >
      <Grid2x2 size={18} />
    </span>
  );
}

export function useComposioRows({
  live,
  teamId,
  data,
  queryError = null,
  isFetching = false,
  onRetry,
}: {
  live: boolean;
  teamId: string | undefined;
  data: ComposioApps | undefined;
  queryError?: unknown;
  isFetching?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const {
    connectComposioApp,
    authorizeComposioApp,
    reconnectComposioApp,
    pollComposioApp,
    deleteMcpConnector,
  } = useApiMutations(teamId);
  const configured = data?.configured === true;
  const hasError = queryError !== null && queryError !== undefined;
  const all = configured ? (data?.apps ?? []) : [];
  const [busy, setBusy] = useState<string | null>(null);
  const [authWait, setAuthWait] = useState<ComposioAuthWait | null>(null);
  const [disconnecting, setDisconnecting] = useState<McpConnectorRecord | null>(null);
  const [keyDialog, setKeyDialog] = useState(false);

  const pollingId = authWait?.connectorId ?? null;

  useEffect(() => {
    if (!live || pollingId === null) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      pollComposioApp
        .mutateAsync(pollingId)
        .then((record) => {
          if (cancelled) return;
          attempts += 1;
          if (record.status !== 'needs_auth' || attempts >= AUTH_POLL_MAX_ATTEMPTS)
            return setAuthWait((cur) => (cur?.connectorId === pollingId ? null : cur));
          timer = setTimeout(tick, AUTH_POLL_MS);
        })
        .catch(() => {
          if (!cancelled) setAuthWait((cur) => (cur?.connectorId === pollingId ? null : cur));
        });
    };
    timer = setTimeout(tick, AUTH_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live, pollingId, pollComposioApp.mutateAsync]);

  const openAuth = async (connectorId: string, reconnect: boolean) => {
    const result = reconnect
      ? await reconnectComposioApp.mutateAsync(connectorId)
      : await authorizeComposioApp.mutateAsync(connectorId);
    const manualUrl = safeHttpsUrl(result.redirectUrl);
    if (manualUrl !== null) window.open(manualUrl, '_blank', 'noopener,noreferrer');
    if (result.connector.status === 'needs_auth')
      setAuthWait({ connectorId, redirectUrl: manualUrl });
  };

  const run = (key: string, work: () => Promise<void>, failure: string) => {
    if (!live || busy !== null) return;
    setBusy(key);
    work()
      .catch((error: unknown) => toastError(failure, error))
      .finally(() => setBusy(null));
  };

  const connect = (app: ComposioAppEntry) =>
    run(
      app.slug,
      async () => {
        const record = await connectComposioApp.mutateAsync({ slug: app.slug });
        if (record.status === 'needs_auth') await openAuth(record.id, false);
      },
      t('未能接入 {name}，请稍后重试。', { name: app.name }),
    );

  const authorize = (connector: McpConnectorRecord, reconnect: boolean) =>
    run(
      connector.id,
      () => openAuth(connector.id, reconnect),
      t('未能开始 {name} 的授权，请稍后重试。', { name: connector.label }),
    );

  const remove = (connector: McpConnectorRecord) => {
    if (!live) return;
    setAuthWait((cur) => (cur?.connectorId === connector.id ? null : cur));
    deleteMcpConnector.mutate(connector.id, {
      onError: (error) =>
        toastError(t('未能断开 {name}，请稍后重试。', { name: connector.label }), error),
    });
  };

  const keyItem: IntegrationItem = {
    key: 'composio-key',
    testId: 'mcp-composio',
    icon: <ComposioMark />,
    name: 'Composio',
    info: t('经 Composio 接入的应用都用它授权'),
    description: t('API key 已保存'),
    action: (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setKeyDialog(true)}
        data-testid="composio-key-change"
      >
        {t('管理')}
      </Button>
    ),
  };

  const setupItem: IntegrationItem = {
    key: 'composio-setup',
    testId: 'composio-setup-card',
    icon: <ComposioMark />,
    name: t('更多应用'),
    info: t('Slack、Google 日历、Todoist 等上千个应用，经你自己的 Composio 账号交给 Coordinator。'),
    description: t('用你自己的 Composio 账号接入，需另注册'),
    action: (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setKeyDialog(true)}
        data-testid="composio-setup-open"
      >
        {t('设置')}
      </Button>
    ),
  };

  const items = (view: AppsView): IntegrationItem[] => {
    if (data === undefined || hasError) return [];
    if (!configured) return view === 'available' ? [setupItem] : [];
    const list = all
      .filter((app) => (view === 'connected') === (app.connector !== null))
      .map((app): IntegrationItem => {
        const logoUrl = safeHttpsUrl(app.logoUrl);
        return {
          key: `composio-${app.slug}`,
          testId: `composio-app-${app.slug}`,
          icon:
            logoUrl !== null ? (
              <img
                src={logoUrl}
                alt=""
                aria-hidden
                referrerPolicy="no-referrer"
                className="size-5 flex-none rounded-sm object-cover"
              />
            ) : (
              <McpConnectorIcon catalogId={null} />
            ),
          name: app.name,
          description:
            app.description !== null && app.description !== '' ? app.description : app.slug,
          ...(app.connector !== null
            ? { status: appNote(t, app.connector, pollingId === app.connector.id) }
            : {}),
          action: (
            <ComposioAppActions
              app={app}
              busy={busy}
              authWait={authWait}
              deleting={deleteMcpConnector.isPending}
              onConnect={connect}
              onAuthorize={authorize}
              onCancelAuth={() => setAuthWait(null)}
              onDisconnect={setDisconnecting}
            />
          ),
        };
      });
    return view === 'connected' ? [...list, keyItem] : list;
  };

  return {
    items,
    errorBanner: hasError ? (
      <ComposioErrorBanner
        error={queryError}
        isFetching={isFetching}
        onManageKey={() => setKeyDialog(true)}
        onRetry={() => onRetry?.()}
      />
    ) : null,
    dialog: (
      <>
        {keyDialog && (
          <ComposioKeyDialog
            live={live}
            teamId={teamId}
            configured={configured || hasError}
            onClose={() => setKeyDialog(false)}
          />
        )}
        <DeleteConfirm
          open={disconnecting !== null}
          title={t('断开后需要重新授权才能使用')}
          summary={disconnecting?.label ?? ''}
          ariaLabel={t('断开 {name}', { name: disconnecting?.label ?? '' })}
          onClose={() => setDisconnecting(null)}
          onConfirm={() => {
            if (disconnecting === null) return;
            const target = disconnecting;
            setDisconnecting(null);
            remove(target);
          }}
        />
      </>
    ),
  };
}

function ComposioKeyDialog({
  live,
  teamId,
  configured,
  onClose,
}: {
  live: boolean;
  teamId: string | undefined;
  configured: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { saveComposioKey, deleteComposioKey } = useApiMutations(teamId);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = () => {
    setError(null);
    saveComposioKey.mutate(
      { key: key.trim() },
      { onSuccess: onClose, onError: (err) => setError(keyError(t, err)) },
    );
  };
  const removeKey = () => {
    if (!live) return onClose();
    setError(null);
    deleteComposioKey.mutate(undefined, {
      onSuccess: onClose,
      onError: () => setError(t('未能移除，请稍后重试。')),
    });
  };
  if (confirmRemove) {
    return (
      <DeleteConfirm
        open
        title={t('移除后，经 Composio 接入的所有应用都会断开连接')}
        summary="Composio API key"
        ariaLabel={t('移除 API key')}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          removeKey();
        }}
      />
    );
  }
  return (
    <DialogShell
      title={configured ? 'Composio' : t('用 Composio 接入更多应用')}
      info={
        configured
          ? t('API key 加密存储，经 Composio 接入的应用都用它授权')
          : t(
              'Slack、Google 日历、Todoist 等上千个应用，经你自己的 Composio 账号交给 Coordinator。',
            )
      }
      subtitle={configured ? t('API key 已保存，不会再显示。') : undefined}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2">
          {configured && (
            <Button
              variant="ghost"
              className={`${DIALOG_TEXT_BUTTON} text-destructive`}
              onClick={() => setConfirmRemove(true)}
              disabled={deleteComposioKey.isPending}
              data-testid="composio-key-remove"
            >
              {t('移除 API key')}
            </Button>
          )}
          <span className="flex-1" />
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={key.trim() === '' || saveComposioKey.isPending}
            onClick={save}
            data-testid="composio-key-save"
          >
            {configured ? t('更换 API key') : t('保存并列出应用')}
          </Button>
        </div>
      }
    >
      <FormStack>
        {!configured && (
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-ui text-content-secondary">
            <li>{t('列表里其他应用不需要它，点击「接入」即可。')}</li>
            <li>
              {t('要另注册一个 Composio 账号。免费版每月可调用托管应用 2 万次，个人用一般够。')}
            </li>
            <li>
              {t('授权页上显示的是 Composio：各应用的登录令牌存在 Composio，不在这台电脑上。')}
            </li>
          </ul>
        )}
        <FormField
          label={configured ? t('新的 Composio API key') : 'Composio API key'}
          htmlFor="composio-key"
          help={
            <>
              {t('在 Composio 控制台的 Settings → API Keys 新建一个，以 ak_ 开头。')}{' '}
              <a
                href="https://dashboard.composio.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                {t('打开 Composio 控制台')}
              </a>
            </>
          }
        >
          <Input
            id="composio-key"
            className={FORM_CONTROL_CLS}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ak_…"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            data-testid="composio-key-input"
          />
        </FormField>
        {error !== null && (
          <p role="alert" className="m-0 text-meta text-destructive">
            {error}
          </p>
        )}
      </FormStack>
    </DialogShell>
  );
}

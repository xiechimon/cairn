import type { ComposioAppEntry, ComposioApps, McpConnectorRecord } from '@cairn/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { Grid2x2 } from '../icons/index.js';
import { McpConnectorIcon } from './mcp-connector-icon.js';
import { type AppItem, RowNote } from './parts.js';

const AUTH_POLL_MS = 2_500;
const AUTH_POLL_MAX_ATTEMPTS = 90;

type Translate = (text: string, vars?: Record<string, string | number>) => string;

export type AppsView = 'available' | 'connected';

function appNote(t: Translate, record: McpConnectorRecord, authorizing: boolean): ReactNode {
  if (authorizing || (record.status === 'needs_auth' && record.statusReason === 'authorizing'))
    return <RowNote>{t('等待授权')}</RowNote>;
  if (record.status === 'needs_auth') return <RowNote>{t('需要授权')}</RowNote>;
  if (record.status === 'revoked') return <RowNote danger>{t('授权已收回')}</RowNote>;
  if (record.status === 'error') return <RowNote danger>{t('连不上')}</RowNote>;
  return undefined;
}

function keyError(t: Translate, error: unknown): string {
  if (error instanceof ApiError && error.status === 400)
    return t('这把 key 没有通过检查，确认完整复制后再保存。');
  return t('没能保存，稍后重试。');
}

export function ComposioMark() {
  return (
    <span
      aria-hidden
      className="flex size-5 flex-none items-center justify-center text-content-secondary"
    >
      <Grid2x2 width={18} height={18} />
    </span>
  );
}

export function useComposioRows({
  live,
  teamId,
  data,
}: {
  live: boolean;
  teamId: string | undefined;
  data: ComposioApps | undefined;
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
  const all = configured ? (data?.apps ?? []) : [];
  const [busy, setBusy] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [keyDialog, setKeyDialog] = useState(false);

  useEffect(() => {
    if (!live || authorizingId === null) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      pollComposioApp
        .mutateAsync(authorizingId)
        .then((record) => {
          if (cancelled) return;
          attempts += 1;
          if (record.status !== 'needs_auth' || attempts >= AUTH_POLL_MAX_ATTEMPTS)
            return setAuthorizingId(null);
          timer = setTimeout(tick, AUTH_POLL_MS);
        })
        .catch(() => {
          if (!cancelled) setAuthorizingId(null);
        });
    };
    timer = setTimeout(tick, AUTH_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live, authorizingId, pollComposioApp.mutateAsync]);

  const openAuth = async (connectorId: string, reconnect: boolean) => {
    const result = reconnect
      ? await reconnectComposioApp.mutateAsync(connectorId)
      : await authorizeComposioApp.mutateAsync(connectorId);
    if (
      result.redirectUrl !== null &&
      URL.canParse(result.redirectUrl) &&
      new URL(result.redirectUrl).protocol === 'https:'
    ) {
      window.open(result.redirectUrl, '_blank', 'noopener,noreferrer');
    }
    if (result.connector.status === 'needs_auth') setAuthorizingId(connectorId);
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
      t('没能接入 {name}，稍后重试。', { name: app.name }),
    );

  const authorize = (connector: McpConnectorRecord, reconnect: boolean) =>
    run(
      connector.id,
      () => openAuth(connector.id, reconnect),
      t('没能开始 {name} 的授权，稍后重试。', { name: connector.label }),
    );

  const remove = (connector: McpConnectorRecord) => {
    if (!live) return;
    deleteMcpConnector.mutate(connector.id, {
      onError: (error) =>
        toastError(t('没能断开 {name}，稍后重试。', { name: connector.label }), error),
    });
  };

  const action = (app: ComposioAppEntry) => {
    const connector = app.connector;
    const pending = busy === app.slug || busy === connector?.id;
    if (connector === null)
      return (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => connect(app)}
          data-testid={`composio-connect-${app.slug}`}
        >
          {pending ? t('正在连接…') : t('接入')}
        </Button>
      );
    if (connector.status === 'needs_auth') {
      const waiting = authorizingId === connector.id || connector.statusReason === 'authorizing';
      return (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || authorizingId === connector.id}
          onClick={() => authorize(connector, false)}
          data-testid={`composio-authorize-${app.slug}`}
        >
          {pending ? t('正在连接…') : waiting ? t('继续授权') : t('授权')}
        </Button>
      );
    }
    if (connector.status === 'error' || connector.status === 'revoked')
      return (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => authorize(connector, true)}
          data-testid={`composio-reconnect-${app.slug}`}
        >
          {t('重新连接')}
        </Button>
      );
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={deleteMcpConnector.isPending}
        onClick={() => remove(connector)}
        data-testid={`composio-remove-${app.slug}`}
      >
        {t('断开')}
      </Button>
    );
  };

  const keyItem: AppItem = {
    key: 'composio-key',
    testId: 'mcp-composio',
    icon: <ComposioMark />,
    name: 'Composio',
    description: t('key 已保存'),
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

  const setupItem: AppItem = {
    key: 'composio-setup',
    testId: 'composio-setup-card',
    icon: <ComposioMark />,
    name: t('更多应用'),
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

  const items = (view: AppsView): AppItem[] => {
    if (data === undefined) return [];
    if (!configured) return view === 'available' ? [setupItem] : [];
    const list = all
      .filter((app) => (view === 'connected') === (app.connector !== null))
      .map(
        (app): AppItem => ({
          key: `composio-${app.slug}`,
          testId: `composio-app-${app.slug}`,
          icon:
            app.logoUrl !== null ? (
              <img
                src={app.logoUrl}
                alt=""
                aria-hidden
                className="size-5 flex-none rounded-sm object-cover"
              />
            ) : (
              <McpConnectorIcon catalogId={null} />
            ),
          name: app.name,
          description:
            app.description !== null && app.description !== '' ? app.description : app.slug,
          ...(app.connector !== null
            ? { status: appNote(t, app.connector, authorizingId === app.connector.id) }
            : {}),
          action: action(app),
        }),
      );
    return view === 'connected' ? [...list, keyItem] : list;
  };

  return {
    items,
    connectedCount: all.filter((app) => app.connector !== null).length,
    dialog: keyDialog ? (
      <ComposioKeyDialog
        live={live}
        teamId={teamId}
        configured={configured}
        onClose={() => setKeyDialog(false)}
      />
    ) : null,
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
      onError: () => setError(t('没能移除，稍后重试。')),
    });
  };
  return (
    <DialogShell
      title={configured ? 'Composio' : t('用 Composio 接入更多应用')}
      subtitle={
        configured
          ? t('key 已保存，不会再显示。')
          : t('用你自己的 Composio 账号接入 Slack、Google 日历等应用')
      }
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2">
          {configured && (
            <Button
              variant="ghost"
              className={`${DIALOG_TEXT_BUTTON} text-destructive`}
              onClick={removeKey}
              disabled={deleteComposioKey.isPending}
              data-testid="composio-key-remove"
            >
              {t('移除 key')}
            </Button>
          )}
          <span className="flex-1" />
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={key.trim() === '' || saveComposioKey.isPending}
            onClick={save}
            data-testid="composio-key-save"
          >
            {configured ? t('更换 key') : t('保存并列出应用')}
          </Button>
        </div>
      }
    >
      <FormStack>
        {!configured && (
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-ui text-content-secondary">
            <li>{t('列表里其他应用不需要它，直接点「接入」。')}</li>
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
              {t('在 Composio 控制台的 Settings → API Keys 新建一把，以 ak_ 开头。')}{' '}
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

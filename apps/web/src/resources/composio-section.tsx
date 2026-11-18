import type { ComposioAppEntry, ComposioApps, McpConnectorRecord } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { SettingsRow, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import { McpConnectorIcon } from './mcp-connector-icon.js';
import {
  ResourceList,
  ResourceRow,
  RowDesc,
  RowLine,
  RowMeta,
  RowText,
  RowTitle,
} from './parts.js';

const AUTH_POLL_MS = 2_500;
const AUTH_POLL_MAX_ATTEMPTS = 90;

type Translate = (text: string, vars?: Record<string, string | number>) => string;

function appStatus(
  t: Translate,
  record: McpConnectorRecord | null,
  authorizing: boolean,
): { line: string; desc?: string } {
  if (record === null) return { line: t('还没接入') };
  if (authorizing) return { line: t('等待授权，完成后这里自动更新。') };
  switch (record.status) {
    case 'connected':
      return {
        line:
          record.toolCount !== null
            ? t('已连接 · {n} 个工具', { n: record.toolCount })
            : t('已连接'),
      };
    case 'revoked':
      return { line: t('已撤销'), desc: t('Composio 上的授权已收回，重新连接才能再用。') };
    case 'error':
      return { line: t('连不上') };
    case 'needs_auth':
      return record.statusReason === 'authorizing'
        ? { line: t('等待授权，完成后这里自动更新。') }
        : { line: t('需要授权') };
    default:
      return { line: t('还没检查') };
  }
}

function keyError(t: Translate, error: unknown): string {
  if (error instanceof ApiError && error.status === 400)
    return t('这把 key 没有通过检查，确认完整复制后再保存。');
  return t('没能保存，稍后重试。');
}

export function ComposioSection({
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
    saveComposioKey,
    deleteComposioKey,
    connectComposioApp,
    authorizeComposioApp,
    reconnectComposioApp,
    pollComposioApp,
    deleteMcpConnector,
  } = useApiMutations(teamId);
  const configured = data?.configured === true;
  const apps = data?.apps ?? [];
  const [keyDraft, setKeyDraft] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);

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

  const saveKey = () => {
    setError(null);
    saveComposioKey.mutate(
      { key: keyDraft.trim() },
      {
        onSuccess: () => {
          setKeyDraft('');
          setKeyEditing(false);
        },
        onError: (err) => setError(keyError(t, err)),
      },
    );
  };

  const removeKey = () => {
    if (!live) return;
    setError(null);
    deleteComposioKey.mutate(undefined, {
      onError: () => setError(t('没能移除，稍后重试。')),
    });
  };

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
    setError(null);
    setBusy(key);
    work()
      .catch(() => setError(failure))
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
      onError: () => setError(t('没能移除 {name}，稍后重试。', { name: connector.label })),
    });
  };

  const keyInput = (
    <span className="flex min-w-0 flex-auto items-center gap-2">
      <Input
        className={FORM_CONTROL_CLS}
        type="password"
        autoComplete="off"
        placeholder={t('粘贴 API key')}
        value={keyDraft}
        onChange={(event) => setKeyDraft(event.target.value)}
        data-testid="composio-key-input"
      />
      <Button
        size="sm"
        disabled={keyDraft.trim() === '' || saveComposioKey.isPending}
        onClick={saveKey}
        data-testid="composio-key-save"
      >
        {t('保存')}
      </Button>
      {configured && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setKeyDraft('');
            setKeyEditing(false);
          }}
        >
          {t('取消')}
        </Button>
      )}
    </span>
  );

  return (
    <SettingsSection
      title={t('应用')}
      description={t(
        '通过 Composio 把 Gmail、Linear 这类外部应用的工具交给 Coordinator 用。授权在 Composio 的页面里完成，Cairn 不保存各应用的令牌。',
      )}
      testId="mcp-composio"
    >
      <ResourceList className="mt-0">
        <SettingsRow
          label="Composio API key"
          hint={
            configured
              ? t('已保存，加密存储，不会再显示。')
              : t('在 Composio 控制台创建一把 API key 粘贴到这里，用它接入各应用。')
          }
          labelTestId="composio-key-label"
        >
          {configured && !keyEditing ? (
            <>
              <span className="text-meta text-content-secondary">{t('已保存')}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setKeyEditing(true)}
                data-testid="composio-key-change"
              >
                {t('更换')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={removeKey}
                disabled={deleteComposioKey.isPending}
                data-testid="composio-key-remove"
              >
                {t('移除')}
              </Button>
            </>
          ) : (
            keyInput
          )}
        </SettingsRow>
        {configured &&
          apps.map((app) => {
            const connector = app.connector;
            const authorizing = authorizingId !== null && authorizingId === connector?.id;
            const status = appStatus(t, connector, authorizing);
            const pending = busy === app.slug || busy === connector?.id;
            return (
              <ResourceRow mcp key={app.slug} data-composio-app={app.slug}>
                {app.logoUrl !== null ? (
                  <img
                    src={app.logoUrl}
                    alt=""
                    aria-hidden
                    className="size-5 flex-none rounded-sm object-cover"
                  />
                ) : (
                  <McpConnectorIcon catalogId={null} />
                )}
                <RowText>
                  <RowLine>
                    <RowTitle>{app.name}</RowTitle>
                    <RowMeta>{status.line}</RowMeta>
                  </RowLine>
                  <RowDesc>
                    {status.desc ??
                      (app.description !== null && app.description !== ''
                        ? app.description
                        : app.slug)}
                  </RowDesc>
                </RowText>
                <span className="flex flex-none items-center gap-1">
                  {connector === null && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => connect(app)}
                      data-testid={`composio-connect-${app.slug}`}
                    >
                      {pending ? t('正在连接…') : t('接入')}
                    </Button>
                  )}
                  {connector !== null && connector.status === 'needs_auth' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || authorizing}
                      onClick={() => authorize(connector, false)}
                      data-testid={`composio-authorize-${app.slug}`}
                    >
                      {pending
                        ? t('正在连接…')
                        : connector.statusReason === 'authorizing' || authorizing
                          ? t('继续授权')
                          : t('授权')}
                    </Button>
                  )}
                  {connector !== null &&
                    (connector.status === 'connected' ||
                      connector.status === 'error' ||
                      connector.status === 'revoked') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => authorize(connector, true)}
                        data-testid={`composio-reconnect-${app.slug}`}
                      >
                        {t('重新连接')}
                      </Button>
                    )}
                  {connector !== null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={deleteMcpConnector.isPending}
                      onClick={() => remove(connector)}
                      data-testid={`composio-remove-${app.slug}`}
                    >
                      {t('移除')}
                    </Button>
                  )}
                </span>
              </ResourceRow>
            );
          })}
        {configured && apps.length === 0 && (
          <ResourceRow mcp>
            <RowText>
              <RowDesc>{t('Composio 没有返回可接入的应用。')}</RowDesc>
            </RowText>
          </ResourceRow>
        )}
      </ResourceList>
      {error !== null && (
        <p role="alert" className="m-0 text-meta text-destructive">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}

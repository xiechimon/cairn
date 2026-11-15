import {
  MCP_CATALOG,
  type McpCatalogEntry,
  type McpConnectorRecord,
  type StartMcpConnectorOAuthBody,
} from '@cairn/shared';
import { cn } from 'cn';
import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useApiMutations, useMcpConnectors, useMcpServers } from '../api/hooks.js';
import { mapMcpServers } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import { Ban, Plus } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import {
  ConnectorStatus,
  McpConnectorDialog,
  type McpDialogTarget,
  type McpOAuthRequest,
  type McpSignIn,
  McpSignInDialog,
} from './mcp-connector-dialog.js';
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

export const MCP_HREF = '/app/resources/mcp-servers';

type FixtureDialog =
  | { kind: 'catalog'; catalogId: string }
  | { kind: 'custom' }
  | { kind: 'manage'; connectorId: string }
  | { kind: 'authorizing'; catalogId: string }
  | { kind: 'confirm'; name: string; host: string }
  | { kind: 'landing'; reason: string };

function initialTarget(
  ui: FixtureDialog | undefined,
  connectors: readonly McpConnectorRecord[],
): McpDialogTarget | null {
  if (ui === undefined || !['catalog', 'custom', 'manage'].includes(ui.kind)) return null;
  if (ui.kind === 'custom') return { kind: 'custom' };
  if (ui.kind === 'catalog') {
    const entry = MCP_CATALOG.find((e) => e.id === ui.catalogId);
    return entry === undefined ? null : { kind: 'catalog', entry };
  }
  if (ui.kind !== 'manage') return null;
  const connector = connectors.find((c) => c.id === ui.connectorId);
  return connector === undefined ? null : { kind: 'manage', connector };
}

export function McpServersPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const mcpQ = useMcpServers(teamId, live);
  const connectorsQ = useMcpConnectors(teamId, live);
  const local = live
    ? mapMcpServers(mcpQ.data ?? [], Date.now())
    : (fixture.resources?.mcpServers ?? []);
  const connectors = live ? (connectorsQ.data ?? []) : (fixture.resources?.mcpConnectors ?? []);
  const fixtureDialog = fixture.ui?.mcpDialog;
  const [dialog, setDialog] = useState<McpDialogTarget | null>(() =>
    initialTarget(fixtureDialog, connectors),
  );
  const [authorizing, setAuthorizing] = useState<string | null>(
    fixtureDialog?.kind === 'authorizing' ? fixtureDialog.catalogId : null,
  );
  const [signIn, setSignIn] = useState<McpSignIn | null>(
    fixtureDialog?.kind === 'confirm'
      ? { name: fixtureDialog.name, host: fixtureDialog.host, authorizationUrl: '#' }
      : null,
  );
  const [landingError, setLandingError] = useState<string | null>(
    fixtureDialog?.kind === 'landing' ? oauthReasonCopy(fixtureDialog.reason, t) : null,
  );
  const connectedCatalog = new Set(connectors.map((c) => c.catalogId));
  const available = MCP_CATALOG.filter((entry) => !connectedCatalog.has(entry.id));

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    setLandingError(oauth === 'error' ? oauthReasonCopy(searchParams.get('reason'), t) : null);
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    next.delete('connector');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  const startSignIn = (
    key: string,
    body: StartMcpConnectorOAuthBody,
    name: string,
    entry?: McpCatalogEntry,
  ) => {
    setLandingError(null);
    if (!live) {
      const host = entry !== undefined ? hostOf(entry.url) : name;
      return setSignIn({ name, host, authorizationUrl: '#', ...(entry ? { entry } : {}) });
    }
    setAuthorizing(key);
    mutations.startMcpConnectorOAuth.mutate(body, {
      onSuccess: ({ authorizationUrl }) =>
        setSignIn({
          name,
          host: hostOf(authorizationUrl),
          authorizationUrl,
          ...(entry ? { entry } : {}),
        }),
      onError: (error) => setLandingError(signInError(t, error, name)),
      onSettled: () => setAuthorizing(null),
    });
  };

  const requestSignIn = (request: McpOAuthRequest) => {
    setDialog(null);
    if (request.kind === 'custom') return startSignIn(request.slug, request, request.label);
    const entry = MCP_CATALOG.find((e) => e.id === request.connector.catalogId);
    startSignIn(
      request.connector.id,
      { kind: 'reconnect', connectorId: request.connector.id },
      request.connector.label,
      entry,
    );
  };

  const connect = (entry: McpCatalogEntry) => {
    if (entry.auth.includes('oauth'))
      return startSignIn(
        entry.id,
        { kind: 'catalog', catalogId: entry.id, slug: entry.id },
        entry.name,
        entry,
      );
    if (entry.auth.includes('none')) {
      if (live)
        mutations.createMcpConnector.mutate({
          kind: 'catalog',
          catalogId: entry.id,
          slug: entry.id,
        });
      return;
    }
    setDialog({ kind: 'catalog', entry });
  };

  return (
    <PageShell
      route={MCP_HREF}
      title={t('MCP 服务器')}
      selected={MCP_HREF}
      actions={
        <Button
          className={TOPBAR_PRIMARY_BUTTON}
          onClick={() => setDialog({ kind: 'custom' })}
          data-testid="mcp-add-server"
        >
          <Plus aria-hidden strokeWidth={1.75} className="size-4" />
          {t('添加 MCP 服务器')}
        </Button>
      }
      fixture={fixture}
    >
      <QueryBoundary
        query={live ? connectorsQ : undefined}
        isEmpty={false}
        loadingLabel={t('正在加载 MCP 服务器')}
        errorTitle={t('MCP 服务器没能加载')}
        className="mt-6"
        empty={null}
      >
        <div className="mt-6 flex flex-col gap-8">
          {landingError !== null && (
            <NoticeBanner
              tone="danger"
              icon={Ban}
              title={landingError}
              data-testid="mcp-oauth-error"
              actions={
                <Button variant="ghost" size="sm" onClick={() => setLandingError(null)}>
                  {t('知道了')}
                </Button>
              }
            />
          )}
          {connectors.length > 0 && (
            <SettingsSection title={t('已接入')} testId="mcp-connected">
              <CardGrid>
                {connectors.map((record) => {
                  const entry = MCP_CATALOG.find((e) => e.id === record.catalogId);
                  return (
                    <ConnectorCard
                      key={record.id}
                      catalogId={record.catalogId}
                      name={record.label}
                      description={entry !== undefined ? t(entry.description) : hostOf(record.url)}
                      status={<ConnectorStatus record={record} />}
                      action={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'manage', connector: record })}
                          aria-label={t('管理 {name}', { name: record.label })}
                        >
                          {t('管理')}
                        </Button>
                      }
                    />
                  );
                })}
              </CardGrid>
            </SettingsSection>
          )}
          {available.length > 0 && (
            <SettingsSection title={t('可接入')} testId="mcp-catalog">
              <CardGrid>
                {available.map((entry) => (
                  <ConnectorCard
                    key={entry.id}
                    catalogId={entry.id}
                    name={entry.name}
                    description={t(entry.description)}
                    status={
                      authorizing === entry.id ? (
                        <span className="text-meta text-content-tertiary">
                          {t('正在找到 {name} 的登录地址…', { name: entry.name })}
                        </span>
                      ) : undefined
                    }
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={authorizing === entry.id}
                        onClick={() => connect(entry)}
                        aria-label={t('接入 {name}', { name: entry.name })}
                      >
                        {authorizing === entry.id ? t('正在准备…') : t('接入')}
                      </Button>
                    }
                  />
                ))}
              </CardGrid>
            </SettingsSection>
          )}
          {local.length > 0 && (
            <SettingsSection
              title={t('本机配置')}
              description={t('来自服务器所在电脑的 ~/.claude.json，在那里修改。')}
              testId="mcp-local"
            >
              <ResourceList className="mt-0">
                {local.map((server) => (
                  <ResourceRow mcp key={server.name}>
                    <RowText>
                      <RowLine>
                        <RowTitle>{server.name}</RowTitle>
                        <RowMeta>{t(server.kind)}</RowMeta>
                      </RowLine>
                      <RowDesc>{server.url}</RowDesc>
                    </RowText>
                    <RowMeta>{t(server.ago)}</RowMeta>
                  </ResourceRow>
                ))}
              </ResourceList>
            </SettingsSection>
          )}
        </div>
      </QueryBoundary>
      <McpConnectorDialog
        target={dialog}
        live={live}
        teamId={teamId}
        onClose={() => setDialog(null)}
        onSignIn={requestSignIn}
      />
      {signIn !== null && (
        <McpSignInDialog
          signIn={signIn}
          onClose={() => setSignIn(null)}
          onUseToken={(entry) => {
            setSignIn(null);
            setDialog({ kind: 'catalog', entry });
          }}
        />
      )}
    </PageShell>
  );
}

function signInError(
  t: (text: string, vars?: Record<string, string>) => string,
  error: unknown,
  name: string,
): string {
  if (error instanceof ApiError && error.status === 409)
    return t('标识 {name} 已经被占用了，先删掉旧的连接或换个名字。', { name });
  if (error instanceof ApiError && error.status === 400)
    return t('{name} 不支持浏览器登录。改用令牌或请求头连接。', { name });
  if (error instanceof ApiError && error.status === 502)
    return t('{name} 的登录服务没有接受 Cairn 的注册，稍后重试。', { name });
  return t('没能开始登录 {name}，稍后重试。', { name });
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function ConnectorCard({
  catalogId,
  name,
  description,
  status,
  action,
}: {
  catalogId: string | null;
  name: string;
  description: string;
  status?: ReactNode;
  action: ReactNode;
}) {
  return (
    <Card
      size="sm"
      data-connector-card={catalogId ?? name}
      className={cn('min-h-28 gap-2 rounded-(--radius-card) px-4 ring-border')}
    >
      <div className="flex items-center gap-3">
        <McpConnectorIcon catalogId={catalogId} />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{name}</span>
        {action}
      </div>
      <p className="m-0 line-clamp-2 text-meta text-content-tertiary">{description}</p>
      {status !== undefined && <div className="mt-auto">{status}</div>}
    </Card>
  );
}

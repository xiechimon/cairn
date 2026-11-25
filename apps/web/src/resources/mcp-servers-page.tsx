import {
  isLocalCatalogEntry,
  MCP_CATALOG,
  type McpCatalogEntry,
  type McpConnectorRecord,
  type StartMcpConnectorOAuthBody,
  startMcpConnectorOAuthBodySchema,
} from '@cairn/shared';
import { Ban, Mail, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import {
  useApiMutations,
  useComposioApps,
  useGithubConnector,
  useMcpConnectors,
  useMcpServers,
} from '../api/hooks.js';
import { mapMcpServers } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { mergeQueries, QueryBoundary } from '../components/query-state.js';
import { SettingsCard, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import type { GithubDeviceFixtureStep } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { useComposioRows } from './composio-section.js';
import { MCP_HREF } from './hrefs.js';
import { useMailConnectors } from './mail-connectors.js';
import {
  McpConnectorDialog,
  type McpDialogTarget,
  type McpOAuthRequest,
  type McpSignIn,
  McpSignInDialog,
} from './mcp-connector-dialog.js';
import { McpConnectorIcon } from './mcp-connector-icon.js';
import { GithubDeviceDialog } from './mcp-github-device-dialog.js';
import {
  type IntegrationItem,
  IntegrationRow,
  ResourceList,
  ResourceRow,
  RowDesc,
  RowLine,
  RowMeta,
  RowNote,
  RowText,
  RowTitle,
} from './parts.js';

type FixtureDialog =
  | { kind: 'catalog'; catalogId: string }
  | { kind: 'custom' }
  | { kind: 'manage'; connectorId: string }
  | { kind: 'authorizing'; catalogId: string }
  | { kind: 'confirm'; name: string; host: string }
  | { kind: 'landing'; reason: string; name?: string }
  | { kind: 'github-device'; step: GithubDeviceFixtureStep };

interface DeviceTarget {
  connectorId?: string;
  bound?: McpConnectorRecord;
  run: number;
}

interface SignInAttempt {
  name: string;
  body: StartMcpConnectorOAuthBody;
  catalogId?: string;
}

interface SignInNotice {
  title: string;
  body: string;
  retry?: SignInAttempt;
}

type Translate = (text: string, vars?: Record<string, string>) => string;

const ATTEMPT_KEY = 'cairn.mcpSignInAttempt';

function saveAttempt(attempt: SignInAttempt) {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {}
}

function readAttempt(): SignInAttempt | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null || !('name' in raw) || !('body' in raw))
      return null;
    const body = startMcpConnectorOAuthBodySchema.safeParse(raw.body);
    if (typeof raw.name !== 'string' || !body.success) return null;
    const catalogId =
      'catalogId' in raw && typeof raw.catalogId === 'string' ? raw.catalogId : null;
    return { name: raw.name, body: body.data, ...(catalogId !== null ? { catalogId } : {}) };
  } catch {
    return null;
  }
}

function forgetAttempt() {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {}
}

function landingNotice(t: Translate, reason: string | null, attempt: SignInAttempt | null) {
  const body =
    reason === 'denied'
      ? t('你取消了授权，这次什么都没有保存。')
      : reason === 'state'
        ? t('登录等得太久已经失效，重新接入一次。')
        : reason === 'conflict'
          ? t('授权期间这个连接有了变动，这次授权没有保存。')
          : t('登录没有完成，在下面重新接入一次。');
  return {
    title: attempt !== null ? t('未能连接 {name}', { name: attempt.name }) : t('未能完成登录'),
    body,
    ...(attempt !== null ? { retry: attempt } : {}),
  };
}

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
    ? mapMcpServers(
        (mcpQ.data ?? []).filter((row) => row.source === 'local'),
        Date.now(),
      )
    : (fixture.resources?.mcpServers ?? []);
  const composioQ = useComposioApps(teamId, live);
  const composioApps = live ? composioQ.data : fixture.resources?.composioApps;
  const connectors = (
    live ? (connectorsQ.data ?? []) : (fixture.resources?.mcpConnectors ?? [])
  ).filter((record) => record.authKind !== 'composio');
  const githubQ = useGithubConnector(teamId, live);
  const githubApp = live ? githubQ.data : fixture.resources?.githubConnector;
  const fixtureDialog = fixture.ui?.mcpDialog;
  const fixtureDevice = fixtureDialog?.kind === 'github-device' ? fixtureDialog.step : undefined;
  const fixtureGithub = connectors.find((c) => c.authKind === 'github-app');
  const [device, setDevice] = useState<DeviceTarget | null>(() =>
    fixtureDevice === undefined
      ? null
      : {
          run: 0,
          ...(fixtureDevice === 'reconnect' && fixtureGithub !== undefined
            ? { connectorId: fixtureGithub.id }
            : {}),
        },
  );
  const [dialog, setDialog] = useState<McpDialogTarget | null>(() =>
    initialTarget(fixtureDialog, connectors),
  );
  const [authorizing, setAuthorizing] = useState<string | null>(
    fixtureDialog?.kind === 'authorizing' ? fixtureDialog.catalogId : null,
  );
  const [signIn, setSignIn] = useState<(McpSignIn & { attempt?: SignInAttempt }) | null>(
    fixtureDialog?.kind === 'confirm'
      ? { name: fixtureDialog.name, host: fixtureDialog.host, authorizationUrl: '#' }
      : null,
  );
  const [notice, setNotice] = useState<SignInNotice | null>(() => {
    if (fixtureDialog?.kind !== 'landing') return null;
    const entry = MCP_CATALOG.find((e) => e.name === fixtureDialog.name);
    return landingNotice(
      t,
      fixtureDialog.reason,
      entry !== undefined ? catalogAttempt(entry) : null,
    );
  });
  const mail = useMailConnectors({
    teamId,
    live,
    fixtureAccounts: fixture.resources?.mailAccounts ?? [],
  });
  const mailConnected = mail.cards.filter((card) => card.connected);
  const mailAvailable = mail.cards.filter((card) => !card.connected);
  const connectedCatalog = new Set(connectors.map((c) => c.catalogId));
  const available = MCP_CATALOG.filter((entry) => !connectedCatalog.has(entry.id));
  const composio = useComposioRows({ live, teamId, data: composioApps });
  const connectButton = (label: string, onClick: () => void, busy = false) => (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={onClick}
      aria-label={t('接入 {name}', { name: label })}
    >
      {busy ? t('正在准备…') : t('接入')}
    </Button>
  );
  const manageButton = (label: string, onClick: () => void) => (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-label={t('管理 {name}', { name: label })}
    >
      {t('管理')}
    </Button>
  );
  const connectedItems: IntegrationItem[] = [
    ...connectors.map((record): IntegrationItem => {
      const entry = MCP_CATALOG.find((e) => e.id === record.catalogId);
      return {
        key: record.id,
        icon: <McpConnectorIcon catalogId={record.catalogId} />,
        name: record.label,
        description: entry !== undefined ? t(entry.description) : hostOf(record.url ?? ''),
        ...(record.status === 'needs_auth'
          ? { status: <RowNote>{t('需要重新授权')}</RowNote> }
          : record.status === 'error'
            ? { status: <RowNote danger>{t('无法连接')}</RowNote> }
            : record.status === 'local'
              ? { status: <RowNote>{t('在你的 Chrome 里')}</RowNote> }
              : record.status === 'unchecked'
                ? { status: <RowNote>{t('未检查')}</RowNote> }
                : {}),
        action: manageButton(record.label, () => setDialog({ kind: 'manage', connector: record })),
      };
    }),
    ...mailConnected.map(
      (card): IntegrationItem => ({
        key: card.provider,
        testId: `mail-card-${card.provider}`,
        icon: <MailIcon />,
        name: t(card.name),
        description: mail.summaryOf(card.provider),
        ...(card.needsAttention ? { status: <RowNote danger>{t('需要处理')}</RowNote> } : {}),
        action: manageButton(t(card.name), card.open),
      }),
    ),
    ...composio.items('connected'),
  ];
  const availableItems: IntegrationItem[] = [
    ...available.map(
      (entry): IntegrationItem => ({
        key: entry.id,
        icon: <McpConnectorIcon catalogId={entry.id} />,
        name: entry.name,
        description: t(entry.description),
        ...(authorizing === entry.id
          ? { status: <RowNote>{t('正在找到 {name} 的登录地址…', { name: entry.name })}</RowNote> }
          : {}),
        action: connectButton(entry.name, () => connect(entry), authorizing === entry.id),
      }),
    ),
    ...mailAvailable.map(
      (card): IntegrationItem => ({
        key: card.provider,
        testId: `mail-card-${card.provider}`,
        icon: <MailIcon />,
        name: t(card.name),
        info: t(card.info),
        description: t(card.description),
        action: connectButton(t(card.name), card.open),
      }),
    ),
    ...composio.items('available'),
  ];

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    if (oauth === 'error') setNotice(landingNotice(t, searchParams.get('reason'), readAttempt()));
    else {
      setNotice(null);
      forgetAttempt();
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    next.delete('connector');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  const startSignIn = (attempt: SignInAttempt) => {
    setNotice(null);
    const { name } = attempt;
    const entry = MCP_CATALOG.find((e) => e.id === attempt.catalogId);
    const withEntry = entry !== undefined ? { entry } : {};
    if (!live) {
      const host = entry !== undefined && !isLocalCatalogEntry(entry) ? hostOf(entry.url) : name;
      return setSignIn({ name, host, authorizationUrl: '#', attempt, ...withEntry });
    }
    const failed = (body: string, retry: boolean) =>
      setNotice({
        title: t('未能连接 {name}', { name }),
        body,
        ...(retry ? { retry: attempt } : {}),
      });
    setAuthorizing(attemptKey(attempt));
    mutations.startMcpConnectorOAuth.mutate(attempt.body, {
      onSuccess: ({ authorizationUrl }) =>
        URL.canParse(authorizationUrl) && new URL(authorizationUrl).protocol === 'https:'
          ? setSignIn({
              name,
              host: new URL(authorizationUrl).host,
              authorizationUrl,
              attempt,
              ...withEntry,
            })
          : failed(t('未能开始登录，请稍后重试。'), true),
      onError: (error) => {
        const status = error instanceof ApiError ? error.status : null;
        failed(signInError(t, status, name), status !== 400 && status !== 409);
      },
      onSettled: () => setAuthorizing(null),
    });
  };

  const requestSignIn = (request: McpOAuthRequest) => {
    setDialog(null);
    if (request.kind === 'reconnect' && request.connector.authKind === 'github-app') {
      const target = { connectorId: request.connector.id, run: 0 };
      if (live && githubApp?.connectionReady === true)
        return mutations.bindGithubConnector.mutate(request.connector.id, {
          onSuccess: (connector) => setDevice({ ...target, bound: connector }),
          onError: () => setDevice(target),
        });
      return setDevice(target);
    }
    if (request.kind === 'custom') return startSignIn({ name: request.label, body: request });
    startSignIn({
      name: request.connector.label,
      body: { kind: 'reconnect', connectorId: request.connector.id },
      ...(request.connector.catalogId !== null ? { catalogId: request.connector.catalogId } : {}),
    });
  };

  const connect = (entry: McpCatalogEntry) => {
    if (isLocalCatalogEntry(entry)) {
      setNotice(null);
      return setDialog({ kind: 'catalog', entry });
    }
    if (entry.auth.includes('github-app') && githubApp?.available === true) {
      setNotice(null);
      if (live && githubApp.connectionReady)
        return mutations.bindGithubConnector.mutate(undefined, {
          onSuccess: (connector) => setDevice({ run: 0, bound: connector }),
          onError: () => setDevice({ run: 0 }),
        });
      return setDevice({ run: 0 });
    }
    if (entry.auth.includes('oauth')) return startSignIn(catalogAttempt(entry));
    if (entry.auth.includes('none')) {
      if (live && !mutations.createMcpConnector.isPending)
        mutations.createMcpConnector.mutate(
          {
            kind: 'catalog',
            catalogId: entry.id,
            slug: entry.id,
          },
          { onError: (error) => toastError(t('接入失败，请重试。'), error) },
        );
      return;
    }
    setDialog({ kind: 'catalog', entry });
  };

  return (
    <PageShell
      route={MCP_HREF}
      title={t('应用')}
      selected={MCP_HREF}
      actions={
        <Button
          className={TOPBAR_PRIMARY_BUTTON}
          onClick={() => setDialog({ kind: 'custom' })}
          data-testid="mcp-add-server"
        >
          <Plus aria-hidden strokeWidth={1.75} className="size-4" />
          {t('自定义 MCP 服务器')}
        </Button>
      }
      fixture={fixture}
    >
      <QueryBoundary
        query={live ? mergeQueries(connectorsQ, mcpQ, composioQ) : undefined}
        isEmpty={false}
        errorWins
        loadingLabel={t('正在加载应用')}
        errorTitle={t('应用未能加载')}
        className="mt-6"
        empty={null}
      >
        <div className="mt-6 flex flex-col gap-8">
          {notice !== null && (
            <NoticeBanner
              tone="danger"
              icon={Ban}
              title={notice.title}
              body={notice.body}
              data-testid="mcp-oauth-error"
              actions={
                <>
                  <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
                    {t('知道了')}
                  </Button>
                  {notice.retry !== undefined && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => notice.retry !== undefined && startSignIn(notice.retry)}
                    >
                      {t('重试')}
                    </Button>
                  )}
                </>
              }
            />
          )}
          {connectedItems.length > 0 && (
            <SettingsSection title={t('已接入')} testId="mcp-connected">
              <SettingsCard>
                {connectedItems.map(({ key, ...item }) => (
                  <IntegrationRow key={key} {...item} />
                ))}
              </SettingsCard>
            </SettingsSection>
          )}
          {availableItems.length > 0 && (
            <SettingsSection title={t('可接入')} testId="mcp-catalog">
              <SettingsCard>
                {availableItems.map(({ key, ...item }) => (
                  <IntegrationRow key={key} {...item} />
                ))}
              </SettingsCard>
            </SettingsSection>
          )}
          {local.length > 0 && (
            <SettingsSection
              title={t('本机配置')}
              description={t('来自服务器所在电脑的本机配置文件，在那里修改。')}
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
      {mail.dialogs}
      {composio.dialog}
      <McpConnectorDialog
        target={dialog}
        live={live}
        teamId={teamId}
        onClose={() => setDialog(null)}
        onSignIn={requestSignIn}
      />
      {device !== null && (
        <GithubDeviceDialog
          key={device.run}
          live={live}
          teamId={teamId}
          {...(device.connectorId !== undefined ? { connectorId: device.connectorId } : {})}
          {...(device.bound !== undefined ? { boundConnector: device.bound } : {})}
          installUrl={githubApp?.installUrl ?? null}
          {...(device.run === 0 && fixtureDevice !== undefined ? { fixture: fixtureDevice } : {})}
          {...(fixtureGithub !== undefined ? { fixtureConnector: fixtureGithub } : {})}
          onClose={() => setDevice(null)}
          onRestart={() => setDevice({ ...device, run: device.run + 1 })}
        />
      )}
      {signIn !== null && (
        <McpSignInDialog
          signIn={signIn}
          onLeave={() => signIn.attempt !== undefined && saveAttempt(signIn.attempt)}
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

function signInError(t: Translate, status: number | null, name: string): string {
  if (status === 409) return t('这个标识已被占用，请先删除旧的连接或更换名称。');
  if (status === 400) return t('{name} 不支持浏览器登录，改用令牌或请求头连接。', { name });
  if (status === 502) return t('{name} 的登录服务没有接受 Cairn 的注册，请稍后重试。', { name });
  return t('未能开始登录，请稍后重试。');
}

function catalogAttempt(entry: McpCatalogEntry): SignInAttempt {
  return {
    name: entry.name,
    catalogId: entry.id,
    body: { kind: 'catalog', catalogId: entry.id, slug: entry.id },
  };
}

function attemptKey({ body }: SignInAttempt): string {
  return body.kind === 'reconnect' ? body.connectorId : body.slug;
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

function MailIcon() {
  return (
    <span
      aria-hidden
      className="flex size-5 flex-none items-center justify-center text-content-secondary"
    >
      <Mail size={18} strokeWidth={1.75} />
    </span>
  );
}

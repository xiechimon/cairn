import type {
  ImConnectionRecord,
  ImConnectionStatus,
  ImPlatform,
  ImWechatLoginStart,
  MachineRecord,
} from '@cairn/shared';
import { Ellipsis, Hash, MessageCircle, MessageSquare, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  registeredMachines,
  useImConnections,
  useImMutations,
  useImPairingRequests,
  useImWechatLoginPoll,
  useMachines,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FormActions, FormField, FormStack } from '../components/form-layout.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { InfoTip } from '../components/info-tip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { QrCode } from '../components/qr-code.js';
import { QueryBoundary } from '../components/query-state.js';
import { SETTINGS_SELECT_TRIGGER_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { SLACK_APP_CREATE_URL } from '../lib/slack-app-manifest.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { IntegrationRow, ResourceRow, RowDesc, RowText, RowTitle } from '../resources/parts.js';

export const IM_ROUTE = 'im-connections';

const STATUS_LABEL: Record<ImConnectionStatus, string> = {
  connecting: '连接中',
  ready: '已连接',
  degraded: '不稳定',
  expired: '凭证失效',
  error: '错误',
};

const PLATFORM_ORDER: readonly ImPlatform[] = ['telegram', 'slack', 'imessage', 'wechat'];

const PLATFORM_COPY: Record<
  ImPlatform,
  { name: string; description: string; info: string; connect: string }
> = {
  telegram: {
    name: 'Telegram 机器人',
    description: '使用机器人 Token 连接',
    info: '按钮和回复都支持。',
    connect: '连接 Telegram',
  },
  slack: {
    name: 'Slack',
    description: '使用应用凭据直连',
    info: '在私聊里和 Coordinator 对话。',
    connect: '连接 Slack',
  },
  imessage: {
    name: 'iMessage',
    description: '借一台一直开机的 Mac 收发 iMessage，不开端口。',
    info: '回复数字或文字就能点卡片上的按钮。',
    connect: '连接 iMessage',
  },
  wechat: {
    name: '微信',
    description: '扫码登录',
    info: '在平时的聊天里和 Coordinator 对话。',
    connect: '连接微信',
  },
};

const platformLabel = (platform: ImPlatform, t: (key: string) => string): string =>
  platform === 'wechat'
    ? t('微信')
    : platform === 'slack'
      ? 'Slack'
      : platform === 'imessage'
        ? 'iMessage'
        : 'Telegram';

function ConnectDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (token: string) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [token, setToken] = useState('');
  const submit = () => {
    if (pending || token.trim() === '') return;
    onSubmit(token.trim());
  };
  return (
    <DialogShell
      title={t('连接 Telegram 机器人')}
      subtitle={t('在 @BotFather 里创建机器人，把 bot token 粘贴到这里。')}
      onClose={onClose}
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('连接 Telegram'),
            onClick: submit,
            disabled: pending || token.trim() === '',
            testId: 'im-connect-submit',
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="123456:ABC…"
          autoComplete="off"
          data-testid="im-token-input"
        />
      </form>
    </DialogShell>
  );
}

function SlackConnectDialog({
  editing,
  onClose,
  onSubmit,
  pending,
}: {
  editing?: ImConnectionRecord;
  onClose: () => void;
  onSubmit: (appToken: string, botToken: string) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [appToken, setAppToken] = useState('');
  const [botToken, setBotToken] = useState('');
  const appTokenRef = useRef<HTMLInputElement>(null);
  const ready = appToken.trim() !== '' && botToken.trim() !== '';
  const submit = () => {
    if (pending || !ready) return;
    onSubmit(appToken.trim(), botToken.trim());
  };
  const updating = editing !== undefined;
  return (
    <DialogShell
      title={updating ? t('更新 Slack 凭据') : t('连接 Slack')}
      subtitle={
        updating ? (
          t('粘贴新的 App-Level Token 和 Bot Token 以替换当前凭据。')
        ) : (
          <>
            <span className="block">{t('新建一个 Slack App，把两个 token 粘贴到这里。')}</span>
            <a
              className="flex min-h-6 w-fit items-center text-foreground pointer-coarse:min-h-11"
              href={SLACK_APP_CREATE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('用 Cairn 的设置创建 Slack App')}
            </a>
          </>
        )
      }
      onClose={onClose}
      initialFocus={appTokenRef}
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: updating ? t('保存') : t('连接 Slack'),
            onClick: submit,
            disabled: pending || !ready,
            testId: 'im-connect-submit',
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FormStack>
          <FormField
            label="App-Level Token"
            htmlFor="im-app-token"
            help={t('Basic Information → App-Level Tokens 里生成，scope 选 connections:write。')}
          >
            <Input
              ref={appTokenRef}
              id="im-app-token"
              type="password"
              value={appToken}
              onChange={(event) => setAppToken(event.target.value)}
              placeholder="xapp-…"
              autoComplete="off"
              data-testid="im-app-token-input"
            />
          </FormField>
          <FormField
            label="Bot Token"
            htmlFor="im-bot-token"
            help={t(
              '先把 Slack App 安装到工作区，再复制 OAuth & Permissions 里的 Bot User OAuth Token。',
            )}
          >
            <Input
              id="im-bot-token"
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder="xoxb-…"
              autoComplete="off"
              data-testid="im-bot-token-input"
            />
          </FormField>
        </FormStack>
      </form>
    </DialogShell>
  );
}

function ImessageConnectDialog({
  machines,
  loading,
  error,
  onRetryMachines,
  onClose,
  onSubmit,
  pending,
}: {
  machines: MachineRecord[];
  loading: boolean;
  error: boolean;
  onRetryMachines: () => void;
  onClose: () => void;
  onSubmit: (machineId: string) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [pickedId, setPickedId] = useState('');
  const machineId = machines.some((m) => m.id === pickedId) ? pickedId : (machines[0]?.id ?? '');
  const ready = !loading && !error && machineId !== '';
  return (
    <DialogShell
      title={t('连接 iMessage')}
      subtitle={t('桥接运行在选中的 Mac 上，和已有的执行机共用一条通道，无需开放端口。')}
      onClose={onClose}
      footer={
        <Button
          className={DIALOG_PRIMARY_BUTTON}
          disabled={pending || !ready}
          onClick={() => onSubmit(machineId)}
          data-testid="im-connect-submit"
        >
          {t('连接 iMessage')}
        </Button>
      }
    >
      <FormStack>
        <FormField
          label={t('运行桥接的 Mac')}
          htmlFor="im-imessage-machine"
          help={t(
            '选择一台始终开机的 Mac。这台 Mac 需要安装 imsg 并授予 iMessage 读取权限；首次连接时会自动安装受管版本。',
          )}
        >
          {loading ? (
            <div aria-busy="true" data-testid="im-machines-loading">
              <span role="status" className="sr-only">
                {t('正在加载执行机')}
              </span>
              <Skeleton className="h-9 w-full" />
            </div>
          ) : error ? (
            <div
              className="flex items-center justify-between gap-2"
              data-testid="im-machines-error"
            >
              <p role="alert" className="m-0 text-meta text-destructive">
                {t('执行机列表未能加载。')}
              </p>
              <Button variant="outline" size="sm" onClick={onRetryMachines}>
                {t('重试')}
              </Button>
            </div>
          ) : machines.length === 0 ? (
            <p className="m-0 text-meta text-content-secondary" data-testid="im-no-machines">
              {t('暂无在线的 Mac 执行机。请先在一台 Mac 上启动执行机。')}
            </p>
          ) : (
            <Select
              value={machineId}
              onValueChange={(next) => {
                if (next !== null) setPickedId(next);
              }}
            >
              <SelectTrigger
                id="im-imessage-machine"
                aria-label={t('运行桥接的 Mac')}
                className={SETTINGS_SELECT_TRIGGER_CLS}
                data-testid="im-machine-select"
              >
                <SelectValue>
                  {machines.find((m) => m.id === machineId)?.name ?? t('选择执行机')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </FormStack>
    </DialogShell>
  );
}

function WechatLoginDialog({
  teamId,
  login,
  restarting,
  onClose,
  onDone,
  onRetry,
}: {
  teamId: string | undefined;
  login: ImWechatLoginStart;
  restarting: boolean;
  onClose: () => void;
  onDone: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [expired, setExpired] = useState(false);
  const failed = expired || login.qr === undefined;
  const poll = useImWechatLoginPoll(teamId, login.loginId, !failed);
  const pollError = !failed && poll.isError;
  const failedText =
    login.qr === undefined ? t('二维码获取失败，请重新扫码。') : t('二维码已过期，请重新扫码。');
  useEffect(() => {
    const data = poll.data;
    if (data === undefined) return;
    if (data.status === 'done') onDone();
    else if (data.status === 'expired') setExpired(true);
  }, [poll.data, onDone]);
  return (
    <DialogShell
      title={t('连接微信')}
      subtitle={failed ? failedText : t('用微信扫描二维码，5 分钟内有效。')}
      onClose={onClose}
      footer={
        failed ? (
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={restarting}
            onClick={onRetry}
            data-testid="im-wechat-retry"
          >
            {t('重新扫码')}
          </Button>
        ) : pollError ? (
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={poll.isFetching}
            onClick={() => void poll.refetch()}
            data-testid="im-wechat-poll-retry"
          >
            {t('重试')}
          </Button>
        ) : undefined
      }
    >
      {failed ? (
        <p
          className="m-0 text-center text-meta text-content-secondary"
          data-testid="im-wechat-expired"
        >
          {failedText}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <QrCode text={login.qr ?? ''} label={t('微信登录二维码')} />
          {pollError ? (
            <p
              role="alert"
              className="m-0 max-w-full text-center text-meta text-destructive"
              data-testid="im-wechat-poll-error"
            >
              {t('网络中断，未能确认扫码状态。请检查网络后重试。')}
            </p>
          ) : (
            <p className="m-0 max-w-full text-center text-meta text-content-tertiary">
              {t('等待微信确认…')}
            </p>
          )}
        </div>
      )}
    </DialogShell>
  );
}

const platformIcon = (platform: ImPlatform) =>
  platform === 'wechat' ? (
    <MessageCircle className="size-5 text-content-secondary" aria-hidden="true" />
  ) : platform === 'slack' ? (
    <Hash className="size-5 text-content-secondary" aria-hidden="true" />
  ) : platform === 'imessage' ? (
    <MessageSquare className="size-5 text-content-secondary" aria-hidden="true" />
  ) : (
    <Send className="size-5 text-content-secondary" aria-hidden="true" />
  );

export function ImConnectionsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const connectionsQ = useImConnections(teamId, live);
  const requestsQ = useImPairingRequests(teamId, live);
  const mutations = useImMutations(teamId);
  const [connecting, setConnecting] = useState(false);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [editingSlack, setEditingSlack] = useState<ImConnectionRecord | null>(null);
  const [connectingImessage, setConnectingImessage] = useState(false);
  const [wechatLogin, setWechatLogin] = useState<{
    login: ImWechatLoginStart;
    connId?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<ImConnectionRecord | null>(null);
  const machinesQ = useMachines(teamId, live && connectingImessage);
  const onlineMachines = registeredMachines(machinesQ.data ?? []).filter((m) => m.online);
  const macMachines = onlineMachines.filter((m) => m.capabilities?.osPlatform === 'darwin');
  const machines =
    macMachines.length > 0 || onlineMachines.some((m) => m.capabilities?.osPlatform !== undefined)
      ? macMachines
      : onlineMachines;
  const connections = connectionsQ.data?.connections ?? [];
  const requests = (requestsQ.data?.requests ?? []).filter((row) => row.status === 'pending');
  const connectionIds = new Set(connections.map((conn) => conn.id));
  const startWechatLogin = (connId?: string) =>
    mutations.startWechatLogin.mutate(connId, {
      onSuccess: (login) => setWechatLogin(connId === undefined ? { login } : { login, connId }),
      onError: (error) => toastError(t('微信登录失败，请重试。'), error),
    });
  const connect = (platform: ImPlatform) =>
    platform === 'telegram'
      ? setConnecting(true)
      : platform === 'slack'
        ? setConnectingSlack(true)
        : platform === 'imessage'
          ? setConnectingImessage(true)
          : startWechatLogin();
  const connectionName = (conn: ImConnectionRecord) =>
    conn.accountLabel ??
    (conn.platform === 'wechat'
      ? t('微信账号')
      : conn.platform === 'slack'
        ? 'Slack'
        : conn.platform === 'imessage'
          ? 'iMessage'
          : t('Telegram 机器人'));
  const remove = () => {
    if (deleting === null) return;
    mutations.deleteConnection.mutate(deleting.id, {
      onError: (error) => toastError(t('删除失败，请重试。'), error),
    });
    setDeleting(null);
  };

  const pairingRow = (request: (typeof requests)[number]) => (
    <ResourceRow key={request.id} className="pl-12" data-testid={`im-pairing-${request.id}`}>
      <RowText>
        <RowTitle>{request.senderName ?? request.senderId}</RowTitle>
        <RowDesc>
          {t('请求配对 · {platform}', { platform: platformLabel(request.platform, t) })}
        </RowDesc>
      </RowText>
      <span className="flex flex-none items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={mutations.decidePairing.isPending}
          onClick={() =>
            mutations.decidePairing.mutate(
              { id: request.id, decision: 'rejected' },
              { onError: (error) => toastError(t('拒绝失败，请重试。'), error) },
            )
          }
          data-testid={`im-reject-${request.id}`}
        >
          {t('拒绝')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={mutations.decidePairing.isPending}
          onClick={() =>
            mutations.decidePairing.mutate(
              { id: request.id, decision: 'approved' },
              { onError: (error) => toastError(t('批准失败，请重试。'), error) },
            )
          }
          data-testid={`im-approve-${request.id}`}
        >
          {t('批准')}
        </Button>
      </span>
    </ResourceRow>
  );

  const repairButton = (conn: ImConnectionRecord) =>
    conn.status === 'expired' && conn.platform === 'wechat' ? (
      <Button
        variant="outline"
        size="sm"
        disabled={mutations.startWechatLogin.isPending}
        onClick={() => startWechatLogin(conn.id)}
        data-testid={`im-rescan-${conn.id}`}
      >
        {t('重新扫码')}
      </Button>
    ) : conn.status === 'expired' && conn.platform === 'slack' ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEditingSlack(conn)}
        data-testid={`im-update-slack-${conn.id}`}
      >
        {t('更新凭据')}
      </Button>
    ) : conn.status === 'expired' || conn.status === 'error' ? (
      <Button
        variant="outline"
        size="sm"
        disabled={mutations.reconnectConnection.isPending}
        onClick={() =>
          mutations.reconnectConnection.mutate(conn.id, {
            onError: (error) => toastError(t('重连失败，请重试。'), error),
          })
        }
        data-testid={`im-reconnect-${conn.id}`}
      >
        {t('重连')}
      </Button>
    ) : null;

  const connectionRow = (conn: ImConnectionRecord) => {
    const failing = conn.status === 'expired' || conn.status === 'error';
    const detail = conn.statusDetail ?? conn.lastSendError;
    const name = connectionName(conn);
    return (
      <IntegrationRow
        key={conn.id}
        testId={`im-connection-${conn.id}`}
        icon={platformIcon(conn.platform)}
        name={name}
        {...(conn.accountLabel !== null ? { kind: t(PLATFORM_COPY[conn.platform].name) } : {})}
        description={
          <>
            <span className={failing ? 'text-destructive' : undefined}>
              {t(STATUS_LABEL[conn.status])}
            </span>
            {conn.pairedSenders.length > 0 &&
              ` · ${t('已配对 {count} 个联系人', { count: conn.pairedSenders.length })}`}
            {detail !== null && ` · ${detail}`}
          </>
        }
        action={
          <>
            {repairButton(conn)}
            <DropdownMenu>
              <IconTooltip
                label={t('{name} 的菜单', { name })}
                trigger={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-testid={`im-menu-${conn.id}`}
                        className="text-content-tertiary hover:bg-transparent hover:text-foreground aria-expanded:bg-menu-hover aria-expanded:text-foreground pointer-coarse:size-11 dark:hover:bg-transparent dark:aria-expanded:bg-menu-hover"
                      />
                    }
                  />
                }
              >
                <Ellipsis aria-hidden strokeWidth={1.75} />
              </IconTooltip>
              <KeyedMenuContent
                side="bottom"
                align="end"
                sideOffset={4}
                className="w-auto min-w-40"
              >
                {live && conn.platform === 'slack' && (
                  <KeyedMenuItem
                    shortcut="E"
                    data-testid={`im-edit-${conn.id}`}
                    onClick={() => setEditingSlack(conn)}
                  >
                    {t('更新凭据')}
                  </KeyedMenuItem>
                )}
                {live && (
                  <KeyedMenuItem
                    shortcut="C"
                    data-testid={`im-connect-another-${conn.id}`}
                    onClick={() => connect(conn.platform)}
                  >
                    {t('再连接一个')}
                  </KeyedMenuItem>
                )}
                <KeyedMenuItem
                  shortcut="D"
                  confirms
                  data-testid={`im-delete-${conn.id}`}
                  onClick={() => setDeleting(conn)}
                >
                  {t('删除')}
                </KeyedMenuItem>
              </KeyedMenuContent>
            </DropdownMenu>
          </>
        }
      />
    );
  };

  const platformRows = (platform: ImPlatform) => {
    const own = connections.filter((conn) => conn.platform === platform);
    const copy = PLATFORM_COPY[platform];
    const orphans = requests.filter(
      (request) => request.platform === platform && !connectionIds.has(request.connId),
    );
    if (own.length === 0)
      return [
        <IntegrationRow
          key={platform}
          testId={`im-platform-${platform}`}
          icon={platformIcon(platform)}
          name={t(copy.name)}
          info={t(copy.info)}
          description={t(copy.description)}
          {...(live
            ? {
                action: (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={platform === 'wechat' && mutations.startWechatLogin.isPending}
                    onClick={() => connect(platform)}
                    data-testid={`im-connect-${platform}`}
                  >
                    {t(copy.connect)}
                  </Button>
                ),
              }
            : {})}
        />,
        ...orphans.map(pairingRow),
      ];
    return [
      ...own.flatMap((conn) => [
        connectionRow(conn),
        ...requests.filter((request) => request.connId === conn.id).map(pairingRow),
      ]),
      ...orphans.map(pairingRow),
    ];
  };

  return (
    <PageShell
      route={IM_ROUTE}
      fixture={fixture}
      selected="none"
      title={t('聊天应用')}
      actions={
        <InfoTip
          info={t(
            '连接 Telegram 机器人、Slack、iMessage 或微信后，就能直接用手机和 Coordinator 对话。',
          )}
        />
      }
    >
      <QueryBoundary
        query={live ? connectionsQ : undefined}
        isEmpty={false}
        empty={null}
        loadingLabel={t('正在加载聊天应用')}
        errorTitle={t('聊天应用未能加载')}
        className="mt-6"
      >
        <section data-testid="im-platforms" className="mt-6">
          <SettingsCard>{PLATFORM_ORDER.flatMap(platformRows)}</SettingsCard>
        </section>
      </QueryBoundary>
      {connecting && (
        <ConnectDialog
          pending={mutations.connectTelegram.isPending}
          onClose={() => setConnecting(false)}
          onSubmit={(token) =>
            mutations.connectTelegram.mutate(token, {
              onSuccess: () => setConnecting(false),
              onError: (error) => toastError(t('连接失败，请重试。'), error),
            })
          }
        />
      )}
      {(connectingSlack || editingSlack !== null) && (
        <SlackConnectDialog
          {...(editingSlack !== null ? { editing: editingSlack } : {})}
          pending={mutations.connectSlack.isPending || mutations.updateSlack.isPending}
          onClose={() => {
            setConnectingSlack(false);
            setEditingSlack(null);
          }}
          onSubmit={(appToken, botToken) => {
            if (editingSlack !== null) {
              mutations.updateSlack.mutate(
                { id: editingSlack.id, appToken, botToken },
                {
                  onSuccess: () => setEditingSlack(null),
                  onError: (error) => toastError(t('保存失败，请重试。'), error),
                },
              );
              return;
            }
            mutations.connectSlack.mutate(
              { appToken, botToken },
              {
                onSuccess: () => setConnectingSlack(false),
                onError: (error) => toastError(t('连接失败，请重试。'), error),
              },
            );
          }}
        />
      )}
      {connectingImessage && (
        <ImessageConnectDialog
          machines={machines}
          loading={live && machinesQ.isPending}
          error={live && machinesQ.isError}
          onRetryMachines={() => void machinesQ.refetch()}
          pending={mutations.connectImessage.isPending}
          onClose={() => setConnectingImessage(false)}
          onSubmit={(machineId) =>
            mutations.connectImessage.mutate(machineId, {
              onSuccess: () => setConnectingImessage(false),
              onError: (error) => toastError(t('连接失败，请重试。'), error),
            })
          }
        />
      )}
      {wechatLogin !== null && (
        <WechatLoginDialog
          key={wechatLogin.login.loginId}
          teamId={teamId}
          login={wechatLogin.login}
          restarting={mutations.startWechatLogin.isPending}
          onClose={() => setWechatLogin(null)}
          onDone={() => {
            void connectionsQ.refetch();
            setWechatLogin(null);
          }}
          onRetry={() => startWechatLogin(wechatLogin.connId)}
        />
      )}
      <DeleteConfirm
        open={deleting !== null}
        title={t('删除后，配对的联系人就不能再通过它找 Coordinator')}
        summary={deleting === null ? '' : connectionName(deleting)}
        ariaLabel={t('删除 {name}', { name: deleting === null ? '' : connectionName(deleting) })}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </PageShell>
  );
}

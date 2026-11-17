import type {
  ImConnectionRecord,
  ImConnectionStatus,
  ImPlatform,
  ImWechatLoginStart,
} from '@cairn/shared';
import { MessageCircle, Send } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  useImConnections,
  useImMutations,
  useImPairingRequests,
  useImWechatLoginPoll,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { QrCode } from '../components/qr-code.js';
import { SettingsFlat, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { StatusChip, type StatusTone } from '../components/ui/status-chip.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { ResourceList, ResourceRow, RowDesc, RowText, RowTitle } from '../resources/parts.js';

export const IM_ROUTE = 'im-connections';

const STATUS_TONE: Record<ImConnectionStatus, StatusTone> = {
  connecting: 'confirm',
  ready: 'done',
  degraded: 'confirm',
  expired: 'failed',
  error: 'failed',
};

const STATUS_LABEL: Record<ImConnectionStatus, string> = {
  connecting: '连接中',
  ready: '已连接',
  degraded: '不稳定',
  expired: '凭证失效',
  error: '错误',
};

const platformLabel = (platform: ImPlatform, t: (key: string) => string): string =>
  platform === 'wechat' ? t('微信') : 'Telegram';

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
  return (
    <DialogShell
      title={t('连接 Telegram 机器人')}
      subtitle={t('在 @BotFather 里创建机器人，把 bot token 粘到这里。')}
      onClose={onClose}
      footer={
        <Button
          className={DIALOG_PRIMARY_BUTTON}
          disabled={pending || token.trim() === ''}
          onClick={() => onSubmit(token.trim())}
          data-testid="im-connect-submit"
        >
          {t('连接 Telegram')}
        </Button>
      }
    >
      <Input
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="123456:ABC…"
        autoComplete="off"
        data-testid="im-token-input"
      />
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
      title={t('连接 WeChat')}
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
          <p className="m-0 max-w-full text-center text-meta text-content-tertiary">
            {t('等待微信确认…')}
          </p>
        </div>
      )}
    </DialogShell>
  );
}

function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function ImCard({
  icon,
  name,
  status,
  description,
  action,
  testId,
}: {
  icon: ReactNode;
  name: string;
  status?: ReactNode;
  description: ReactNode;
  action: ReactNode;
  testId?: string;
}) {
  return (
    <Card size="sm" className="gap-2 rounded-(--radius-card) px-4 ring-border" data-testid={testId}>
      <div className="flex items-center gap-3">
        {icon}
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{name}</span>
        {status}
      </div>
      <div className="m-0 line-clamp-2 text-meta text-content-secondary">{description}</div>
      <div className="mt-auto flex justify-end gap-2">{action}</div>
    </Card>
  );
}

const platformIcon = (platform: ImPlatform) =>
  platform === 'wechat' ? (
    <MessageCircle className="size-5 text-content-secondary" aria-hidden="true" />
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
  const [wechatLogin, setWechatLogin] = useState<ImWechatLoginStart | null>(null);
  const connections = connectionsQ.data?.connections ?? [];
  const requests = (requestsQ.data?.requests ?? []).filter((row) => row.status === 'pending');
  const startWechatLogin = () =>
    mutations.startWechatLogin.mutate(undefined, {
      onSuccess: setWechatLogin,
      onError: (error) => toastError(t('微信登录失败，请重试。'), error),
    });
  const connectedPlatforms = new Set(connections.map((conn) => conn.platform));

  const connectionCard = (conn: ImConnectionRecord) => (
    <ImCard
      key={conn.id}
      testId={`im-connection-${conn.id}`}
      icon={platformIcon(conn.platform)}
      name={
        conn.accountLabel ?? (conn.platform === 'wechat' ? t('WeChat 账号') : t('Telegram 机器人'))
      }
      status={
        <StatusChip tone={STATUS_TONE[conn.status]}>{t(STATUS_LABEL[conn.status])}</StatusChip>
      }
      description={
        <>
          {conn.statusDetail ?? conn.lastSendError ?? ''}
          {conn.pairedSenders.length > 0 &&
            t('已配对 {count} 个联系人', { count: conn.pairedSenders.length })}
        </>
      }
      action={
        <>
          {conn.status === 'expired' && conn.platform === 'wechat' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={mutations.startWechatLogin.isPending}
              onClick={startWechatLogin}
              data-testid={`im-rescan-${conn.id}`}
            >
              {t('重新扫码')}
            </Button>
          ) : (
            (conn.status === 'expired' || conn.status === 'error') && (
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
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={mutations.deleteConnection.isPending}
            onClick={() =>
              mutations.deleteConnection.mutate(conn.id, {
                onError: (error) => toastError(t('删除失败，请重试。'), error),
              })
            }
            data-testid={`im-delete-${conn.id}`}
          >
            {t('删除')}
          </Button>
        </>
      }
    />
  );

  return (
    <PageShell route={IM_ROUTE} fixture={fixture} selected="none" title="IM">
      <div className="mt-6 flex flex-col gap-8">
        <SettingsFlat>
          {live && requests.length > 0 && (
            <SettingsSection title={t('待处理')} testId="im-pending">
              <ResourceList>
                {requests.map((request) => (
                  <ResourceRow key={request.id} data-testid={`im-pairing-${request.id}`}>
                    <RowText>
                      <RowTitle>{request.senderName ?? request.senderId}</RowTitle>
                      <RowDesc>
                        {t('请求配对 · {platform}', {
                          platform: platformLabel(request.platform, t),
                        })}
                      </RowDesc>
                    </RowText>
                    <Button
                      variant="ghost"
                      className={DIALOG_PRIMARY_BUTTON}
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
                    <Button
                      variant="ghost"
                      className={DIALOG_PRIMARY_BUTTON}
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
                  </ResourceRow>
                ))}
              </ResourceList>
            </SettingsSection>
          )}
          {connections.length > 0 && (
            <SettingsSection title={t('已接入')} testId="im-connected">
              <CardGrid>{connections.map(connectionCard)}</CardGrid>
            </SettingsSection>
          )}
          <SettingsSection
            title={t('可接入')}
            description={t('连接 Telegram 机器人或微信后，就能直接用手机和 Coordinator 对话。')}
            testId="im-catalog"
          >
            <CardGrid>
              <ImCard
                testId="im-platform-telegram"
                icon={platformIcon('telegram')}
                name={t('Telegram 机器人')}
                status={
                  connectedPlatforms.has('telegram') ? (
                    <StatusChip tone="done">{t('已连接')}</StatusChip>
                  ) : undefined
                }
                description={t('官方 Bot API：按钮和回复都支持。')}
                action={
                  live ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConnecting(true)}
                      data-testid="im-connect-telegram"
                    >
                      {t('连接 Telegram')}
                    </Button>
                  ) : undefined
                }
              />
              <ImCard
                testId="im-platform-wechat"
                icon={platformIcon('wechat')}
                name={t('微信')}
                status={
                  connectedPlatforms.has('wechat') ? (
                    <StatusChip tone="done">{t('已连接')}</StatusChip>
                  ) : undefined
                }
                description={t('扫码登录，在平时的聊天里和 Coordinator 对话。')}
                action={
                  live ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mutations.startWechatLogin.isPending}
                      onClick={startWechatLogin}
                      data-testid="im-connect-wechat"
                    >
                      {t('连接 WeChat')}
                    </Button>
                  ) : undefined
                }
              />
            </CardGrid>
          </SettingsSection>
        </SettingsFlat>
      </div>
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
      {wechatLogin !== null && (
        <WechatLoginDialog
          key={wechatLogin.loginId}
          teamId={teamId}
          login={wechatLogin}
          restarting={mutations.startWechatLogin.isPending}
          onClose={() => setWechatLogin(null)}
          onDone={() => {
            void connectionsQ.refetch();
            setWechatLogin(null);
          }}
          onRetry={startWechatLogin}
        />
      )}
    </PageShell>
  );
}

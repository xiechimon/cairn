import type { ImConnectionStatus } from '@cairn/shared';
import { MessageCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useImConnections, useImMutations, useImPairingRequests } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/ui/button.js';
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
          {t('连接')}
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

export function ImConnectionsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const connectionsQ = useImConnections(teamId, live);
  const requestsQ = useImPairingRequests(teamId, live);
  const mutations = useImMutations(teamId);
  const [connecting, setConnecting] = useState(false);
  const connections = connectionsQ.data?.connections ?? [];
  const requests = (requestsQ.data?.requests ?? []).filter((row) => row.status === 'pending');

  return (
    <PageShell
      route={IM_ROUTE}
      fixture={fixture}
      selected="none"
      title={t('消息连接')}
      actions={
        live ? (
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            onClick={() => setConnecting(true)}
            data-testid="im-connect-telegram"
          >
            {t('连接 Telegram')}
          </Button>
        ) : null
      }
    >
      {live && connectionsQ.data === undefined ? null : connections.length === 0 ? (
        <EmptyState
          testId="im-connections-empty"
          className="mt-6"
          icon={MessageCircle}
          title={t('还没有消息连接')}
          description={t('连接 Telegram 机器人后，就能直接用手机和 Coordinator 对话。')}
        />
      ) : (
        <ResourceList>
          {connections.map((conn) => (
            <ResourceRow key={conn.id} data-testid={`im-connection-${conn.id}`}>
              <RowText>
                <RowTitle>
                  <span className="inline-flex items-center gap-2">
                    <Send className="size-3.5" aria-hidden="true" />
                    {conn.accountLabel ?? t('Telegram 机器人')}
                    <StatusChip tone={STATUS_TONE[conn.status]}>
                      {t(STATUS_LABEL[conn.status])}
                    </StatusChip>
                  </span>
                </RowTitle>
                <RowDesc>
                  {conn.statusDetail ?? conn.lastSendError ?? ''}
                  {conn.pairedSenders.length > 0 &&
                    t('已配对 {count} 个联系人', { count: conn.pairedSenders.length })}
                </RowDesc>
              </RowText>
              {(conn.status === 'expired' || conn.status === 'error') && (
                <Button
                  variant="ghost"
                  className={DIALOG_PRIMARY_BUTTON}
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
              )}
              <Button
                variant="ghost"
                className={DIALOG_PRIMARY_BUTTON}
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
            </ResourceRow>
          ))}
        </ResourceList>
      )}
      {requests.length > 0 && (
        <ResourceList>
          {requests.map((request) => (
            <ResourceRow key={request.id} data-testid={`im-pairing-${request.id}`}>
              <RowText>
                <RowTitle>{request.senderName ?? request.senderId}</RowTitle>
                <RowDesc>{t('请求配对 · {platform}', { platform: request.platform })}</RowDesc>
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
      )}
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
    </PageShell>
  );
}

import {
  type MailAccountRecord,
  type MailErrorCode,
  type MailRuleKind,
  type MailWakeMode,
  mailServerPreset,
} from '@cairn/shared';
import { Mail, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMailAccounts, useMailMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { FormField, FormStack } from '../components/form-layout.js';
import { SettingsFlat, SettingsSection, SettingsSegmented } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { StatusChip, type StatusTone } from '../components/ui/status-chip.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { ResourceList, ResourceRow, RowDesc, RowText, RowTitle } from '../resources/parts.js';

export const MAIL_ROUTE = 'mail-accounts';

const STATUS_TONE: Record<MailAccountRecord['status'], StatusTone> = {
  disconnected: 'idle',
  connecting: 'idle',
  watching: 'done',
  degraded: 'failed',
  revoked: 'failed',
};

const STATUS_LABEL: Record<MailAccountRecord['status'], string> = {
  disconnected: '已断开',
  connecting: '连接中',
  watching: '已连接',
  degraded: '出错',
  revoked: '出错',
};

const ERROR_TEXT: Record<MailErrorCode, string> = {
  'auth-rejected': '登录被拒绝。请检查邮箱地址，并确认填的是授权码，不是登录密码。',
  'host-not-found': '找不到邮件服务器，请检查 IMAP 地址。',
  'connection-refused': '服务器拒绝了连接，请检查端口。',
  timeout: '连接超时，稍后会自动重试。',
  'connection-lost': '连接中断，稍后会自动重试。',
};

function AddMailboxDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (fields: {
    address: string;
    password: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
  }) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [servers, setServers] = useState({
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '465',
  });
  const [serversEdited, setServersEdited] = useState(false);
  const changeAddress = (next: string) => {
    setAddress(next);
    const preset = mailServerPreset(next);
    if (!serversEdited && preset !== null) {
      setServers({
        imapHost: preset.imapHost,
        imapPort: String(preset.imapPort),
        smtpHost: preset.smtpHost,
        smtpPort: String(preset.smtpPort),
      });
    }
  };
  const editServer = (key: keyof typeof servers, value: string) => {
    setServersEdited(true);
    setServers((current) => ({ ...current, [key]: value }));
  };
  const ready =
    address.trim() !== '' &&
    password !== '' &&
    servers.imapHost.trim() !== '' &&
    servers.smtpHost.trim() !== '';
  return (
    <DialogShell
      title={t('添加邮箱')}
      subtitle={t('新邮件到达时，Coordinator 会收到通知。')}
      onClose={onClose}
      footer={
        <Button
          className={DIALOG_PRIMARY_BUTTON}
          disabled={pending || !ready}
          onClick={() =>
            onSubmit({
              address: address.trim(),
              password,
              imapHost: servers.imapHost.trim(),
              imapPort: Number(servers.imapPort),
              smtpHost: servers.smtpHost.trim(),
              smtpPort: Number(servers.smtpPort),
            })
          }
          data-testid="mail-connect-submit"
        >
          {t('连接邮箱')}
        </Button>
      }
    >
      <FormStack>
        <FormField label={t('邮箱地址')} htmlFor="mail-address">
          <Input
            id="mail-address"
            type="email"
            value={address}
            onChange={(event) => changeAddress(event.target.value)}
            placeholder="name@qq.com"
            autoComplete="off"
            data-testid="mail-address-input"
          />
        </FormField>
        <FormField
          label={t('授权码')}
          htmlFor="mail-password"
          help={t(
            'QQ 邮箱：网页版设置 → 账号 → POP3/IMAP/SMTP 服务，开启 IMAP/SMTP 后生成授权码。Gmail 和 Outlook 用应用专用密码。',
          )}
        >
          <Input
            id="mail-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            data-testid="mail-password-input"
          />
        </FormField>
        <FormField label={t('收信服务器（IMAP）')} htmlFor="mail-imap-host">
          <div className="flex gap-2">
            <Input
              id="mail-imap-host"
              value={servers.imapHost}
              onChange={(event) => editServer('imapHost', event.target.value)}
              placeholder="imap.qq.com"
              autoComplete="off"
              data-testid="mail-imap-host-input"
            />
            <Input
              aria-label={t('IMAP 端口')}
              className="w-24 flex-none"
              inputMode="numeric"
              value={servers.imapPort}
              onChange={(event) => editServer('imapPort', event.target.value)}
              data-testid="mail-imap-port-input"
            />
          </div>
        </FormField>
        <FormField label={t('发信服务器（SMTP）')} htmlFor="mail-smtp-host">
          <div className="flex gap-2">
            <Input
              id="mail-smtp-host"
              value={servers.smtpHost}
              onChange={(event) => editServer('smtpHost', event.target.value)}
              placeholder="smtp.qq.com"
              autoComplete="off"
              data-testid="mail-smtp-host-input"
            />
            <Input
              aria-label={t('SMTP 端口')}
              className="w-24 flex-none"
              inputMode="numeric"
              value={servers.smtpPort}
              onChange={(event) => editServer('smtpPort', event.target.value)}
              data-testid="mail-smtp-port-input"
            />
          </div>
        </FormField>
      </FormStack>
    </DialogShell>
  );
}

function RulesDialog({
  account,
  onClose,
  busy,
  onWakeMode,
  onAddRule,
  onRemoveRule,
}: {
  account: MailAccountRecord;
  onClose: () => void;
  busy: boolean;
  onWakeMode: (mode: MailWakeMode) => void;
  onAddRule: (kind: MailRuleKind, pattern: string) => void;
  onRemoveRule: (ruleId: string) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<MailRuleKind>('sender_allow');
  const [pattern, setPattern] = useState('');
  return (
    <DialogShell
      title={t('唤醒规则')}
      subtitle={account.address}
      onClose={onClose}
      footer={undefined}
    >
      <FormStack>
        <SettingsSegmented
          label={t('唤醒规则')}
          value={account.wakeMode}
          onChange={onWakeMode}
          options={[
            { value: 'all', label: t('全部新邮件'), testId: 'mail-wake-all' },
            { value: 'rules', label: t('仅匹配规则'), testId: 'mail-wake-rules' },
          ]}
        />
        {account.wakeMode === 'all' ? (
          <p className="m-0 text-meta text-content-tertiary">
            {t('收件箱里的每一封新邮件都会唤醒 Coordinator。')}
          </p>
        ) : (
          <>
            <p className="m-0 text-meta text-content-tertiary">
              {t('只有匹配下面任一规则的邮件才唤醒 Coordinator，其余的只在摘要推送里提一下。')}
            </p>
            {account.rules.length > 0 && (
              <ResourceList>
                {account.rules.map((rule) => (
                  <ResourceRow key={rule.id} data-testid={`mail-rule-${rule.id}`}>
                    <RowText>
                      <RowTitle>{rule.pattern}</RowTitle>
                      <RowDesc>
                        {rule.matchKind === 'sender_allow' ? t('发件人') : t('主题包含')}
                      </RowDesc>
                    </RowText>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRemoveRule(rule.id)}
                      data-testid={`mail-rule-remove-${rule.id}`}
                    >
                      {t('删除')}
                    </Button>
                  </ResourceRow>
                ))}
              </ResourceList>
            )}
            <FormField label={t('新规则')} htmlFor="mail-rule-pattern">
              <div className="flex flex-col gap-2">
                <SettingsSegmented
                  label={t('规则类型')}
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'sender_allow', label: t('发件人') },
                    { value: 'subject_contains', label: t('主题包含') },
                  ]}
                />
                <div className="flex gap-2">
                  <Input
                    id="mail-rule-pattern"
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                    placeholder={kind === 'sender_allow' ? 'boss@example.com' : t('发票')}
                    autoComplete="off"
                    data-testid="mail-rule-pattern-input"
                  />
                  <Button
                    variant="outline"
                    disabled={busy || pattern.trim() === ''}
                    onClick={() => {
                      onAddRule(kind, pattern.trim());
                      setPattern('');
                    }}
                    data-testid="mail-rule-add"
                  >
                    {t('添加')}
                  </Button>
                </div>
              </div>
            </FormField>
          </>
        )}
      </FormStack>
    </DialogShell>
  );
}

function describeAccount(
  account: MailAccountRecord,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (account.lastError !== null && account.status !== 'watching') {
    return t(ERROR_TEXT[account.lastError]);
  }
  const wake =
    account.wakeMode === 'all'
      ? t('全部新邮件')
      : t('仅匹配 {count} 条规则', { count: account.rules.length });
  const last =
    account.lastMailAt === null
      ? t('还没有收到新邮件')
      : t('最近一封 {time}', {
          time: new Date(account.lastMailAt).toLocaleString(undefined, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        });
  return `${wake} · ${last}`;
}

export function MailPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const accountsQ = useMailAccounts(teamId, live);
  const mutations = useMailMutations(teamId);
  const [adding, setAdding] = useState(false);
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const accounts = live
    ? (accountsQ.data?.accounts ?? [])
    : (fixture.resources?.mailAccounts ?? []);
  const ruleAccount = accounts.find((account) => account.id === rulesFor);
  const failed = (message: string) => (error: unknown) => toastError(t(message), error);

  return (
    <PageShell
      route={MAIL_ROUTE}
      fixture={fixture}
      selected="none"
      title={t('邮箱')}
      actions={
        live && accounts.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            data-testid="mail-add"
          >
            <Plus aria-hidden strokeWidth={1.75} className="size-4" />
            {t('添加邮箱')}
          </Button>
        ) : null
      }
    >
      <div className="mt-6 flex flex-col gap-8">
        <SettingsFlat>
          {accounts.length === 0 ? (
            <EmptyState
              testId="mail-empty"
              icon={Mail}
              title={t('还没有连接邮箱')}
              description={t('连上邮箱后，新邮件会唤醒 Coordinator，回信前会先问你。')}
              action={{ label: t('添加邮箱'), onClick: () => setAdding(true) }}
            />
          ) : (
            <SettingsSection
              title={t('已连接的邮箱')}
              description={t('Coordinator 回信前总会先给你看一张确认卡。')}
              testId="mail-accounts"
            >
              <ResourceList>
                {accounts.map((account) => (
                  <ResourceRow key={account.id} data-testid={`mail-account-${account.id}`}>
                    <RowText>
                      <RowTitle>{account.address}</RowTitle>
                      <RowDesc>{describeAccount(account, t)}</RowDesc>
                    </RowText>
                    <StatusChip tone={STATUS_TONE[account.status]}>
                      {t(STATUS_LABEL[account.status])}
                    </StatusChip>
                    {live && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRulesFor(account.id)}
                          data-testid={`mail-rules-${account.id}`}
                        >
                          {t('唤醒规则')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={mutations.remove.isPending}
                          onClick={() =>
                            mutations.remove.mutate(account.id, {
                              onError: failed('删除失败，请重试。'),
                            })
                          }
                          data-testid={`mail-remove-${account.id}`}
                        >
                          {t('删除')}
                        </Button>
                      </>
                    )}
                  </ResourceRow>
                ))}
              </ResourceList>
            </SettingsSection>
          )}
        </SettingsFlat>
      </div>
      {adding && (
        <AddMailboxDialog
          pending={mutations.connect.isPending}
          onClose={() => setAdding(false)}
          onSubmit={(fields) =>
            mutations.connect.mutate(
              { ...fields, wakeMode: 'all' },
              {
                onSuccess: () => setAdding(false),
                onError: failed('连接失败，请检查填写的内容。'),
              },
            )
          }
        />
      )}
      {ruleAccount !== undefined && (
        <RulesDialog
          account={ruleAccount}
          busy={mutations.addRule.isPending || mutations.removeRule.isPending}
          onClose={() => setRulesFor(null)}
          onWakeMode={(wakeMode) =>
            mutations.setWakeMode.mutate(
              { id: ruleAccount.id, wakeMode },
              { onError: failed('保存失败，请重试。') },
            )
          }
          onAddRule={(matchKind, pattern) =>
            mutations.addRule.mutate(
              { id: ruleAccount.id, rule: { matchKind, pattern } },
              { onError: failed('添加规则失败，请重试。') },
            )
          }
          onRemoveRule={(ruleId) =>
            mutations.removeRule.mutate(
              { id: ruleAccount.id, ruleId },
              { onError: failed('删除失败，请重试。') },
            )
          }
        />
      )}
    </PageShell>
  );
}

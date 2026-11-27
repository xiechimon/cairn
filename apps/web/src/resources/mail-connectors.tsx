import {
  type MailAccountRecord,
  type MailErrorCode,
  type MailRuleKind,
  type MailWakeMode,
  mailServerPreset,
} from '@cairn/shared';
import { type ReactNode, useState } from 'react';
import { useMailAccounts, useMailMutations } from '../api/hooks.js';
import { formatRetryClock } from '../board/retry-copy.js';
import { FormField, FormStack } from '../components/form-layout.js';
import { SettingsSegmented } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { StatusChip, type StatusTone } from '../components/ui/status-chip.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { ResourceList, ResourceRow, RowDesc, RowText, RowTitle } from './parts.js';

type MailProvider = 'qq' | 'gmail' | 'other';

const MAIL_PROVIDERS: readonly MailProvider[] = ['qq', 'gmail', 'other'];

const mailProviderOf = (address: string): MailProvider => {
  const domain = address.trim().toLowerCase().split('@')[1];
  return domain === 'qq.com' || domain === 'foxmail.com'
    ? 'qq'
    : domain === 'gmail.com'
      ? 'gmail'
      : 'other';
};

const MAIL_STATUS_TONE: Record<MailAccountRecord['status'], StatusTone> = {
  disconnected: 'idle',
  connecting: 'idle',
  watching: 'done',
  degraded: 'failed',
  revoked: 'failed',
};

const MAIL_STATUS_LABEL: Record<MailAccountRecord['status'], string> = {
  disconnected: '已断开',
  connecting: '连接中',
  watching: '已连接',
  degraded: '出错',
  revoked: '出错',
};

const ERROR_TEXT: Record<MailErrorCode, string> = {
  'auth-rejected': '登录被拒绝。请检查邮箱地址，并确认填的是授权码或应用专用密码，不是登录密码。',
  'host-not-found': '找不到邮件服务器，请检查 IMAP 地址。',
  'connection-refused': '服务器拒绝了连接，请检查端口。',
  timeout: '连接超时，将按 5 秒至 5 分钟间隔自动退避重试。',
  'connection-lost': '连接中断，将按 5 秒至 5 分钟间隔自动退避重试。',
};

const PROVIDER_FORM: Record<
  MailProvider,
  { title: string; secretLabel: string; help: string; placeholder: string; presetAddress: string }
> = {
  qq: {
    title: '连接 QQ 邮箱',
    secretLabel: '授权码',
    help: 'QQ 邮箱：网页版设置 → 账号 → POP3/IMAP/SMTP 服务，开启 IMAP/SMTP 后生成授权码，填授权码，不要填 QQ 密码。',
    placeholder: 'name@qq.com',
    presetAddress: 'x@qq.com',
  },
  gmail: {
    title: '连接 Gmail',
    secretLabel: '应用专用密码',
    help: 'Gmail：先在 Google 账号里开启两步验证，再打开 myaccount.google.com/apppasswords 生成 16 位应用专用密码，填它，不要填登录密码。',
    placeholder: 'name@gmail.com',
    presetAddress: 'x@gmail.com',
  },
  other: {
    title: '连接其他邮箱',
    secretLabel: '授权码或应用专用密码',
    help: 'Outlook 等海外邮箱用应用专用密码；163、126 等国内邮箱在网页版设置的 IMAP/SMTP 服务页生成授权码。',
    placeholder: 'name@example.com',
    presetAddress: '',
  },
};

function AddMailboxDialog({
  provider,
  stacked,
  onClose,
  onSubmit,
  pending,
}: {
  provider: MailProvider;
  stacked: boolean;
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
  const form = PROVIDER_FORM[provider];
  const initialPreset = mailServerPreset(form.presetAddress);
  const [servers, setServers] = useState({
    imapHost: initialPreset?.imapHost ?? '',
    imapPort: String(initialPreset?.imapPort ?? 993),
    smtpHost: initialPreset?.smtpHost ?? '',
    smtpPort: String(initialPreset?.smtpPort ?? 465),
  });
  const [serversEdited, setServersEdited] = useState(false);
  const [serversOpen, setServersOpen] = useState(provider === 'other');
  const changeAddress = (next: string) => {
    setAddress(next);
    const preset = mailServerPreset(next);
    if (provider === 'other' && !serversEdited && preset !== null) {
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
      title={t(form.title)}
      info={t('新邮件到达时，Coordinator 会收到通知。')}
      stacked={stacked}
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
            spellCheck={false}
            value={address}
            onChange={(event) => changeAddress(event.target.value)}
            placeholder={form.placeholder}
            autoComplete="off"
            data-testid="mail-address-input"
          />
        </FormField>
        <FormField label={t(form.secretLabel)} htmlFor="mail-password" help={t(form.help)}>
          <Input
            id="mail-password"
            type="password"
            spellCheck={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            data-testid="mail-password-input"
          />
        </FormField>
        {provider !== 'other' && !serversOpen ? (
          <div className="flex items-center justify-between gap-2 text-meta text-content-tertiary">
            <span className="min-w-0 truncate font-mono">
              {servers.imapHost}:{servers.imapPort} · {servers.smtpHost}:{servers.smtpPort}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="flex-none text-content-secondary"
              onClick={() => setServersOpen(true)}
            >
              {t('自定义服务器和端口')}
            </Button>
          </div>
        ) : (
          <>
            <FormField label={t('收信服务器（IMAP）')} htmlFor="mail-imap-host">
              <div className="flex gap-2">
                <Input
                  id="mail-imap-host"
                  value={servers.imapHost}
                  onChange={(event) => editServer('imapHost', event.target.value)}
                  placeholder="imap.example.com"
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
                  placeholder="smtp.example.com"
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
          </>
        )}
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
  onAddRule: (kind: MailRuleKind, pattern: string) => Promise<void>;
  onRemoveRule: (ruleId: string) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<MailRuleKind>('sender_allow');
  const [pattern, setPattern] = useState('');
  return (
    <DialogShell
      title={t('唤醒规则')}
      subtitle={account.address}
      stacked
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
              {t('只有匹配下方任一规则的邮件才唤醒 Coordinator，其余邮件只在摘要推送中列出。')}
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
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const trimmed = pattern.trim();
                    if (busy || trimmed === '') return;
                    void onAddRule(kind, trimmed).then(
                      () => setPattern(''),
                      () => {},
                    );
                  }}
                >
                  <Input
                    id="mail-rule-pattern"
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                    placeholder={kind === 'sender_allow' ? 'boss@example.com' : t('发票')}
                    autoComplete="off"
                    data-testid="mail-rule-pattern-input"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={busy || pattern.trim() === ''}
                    data-testid="mail-rule-add"
                  >
                    {t('添加')}
                  </Button>
                </form>
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
    if (
      (account.lastError === 'timeout' || account.lastError === 'connection-lost') &&
      account.nextRetryAt != null
    ) {
      const attempt = Math.max(1, account.retryAttempt ?? 1);
      const time = formatRetryClock(account.nextRetryAt);
      return account.lastError === 'timeout'
        ? t('连接超时，{time} 自动重试（第 {attempt} 次）。', { time, attempt })
        : t('连接中断，{time} 自动重试（第 {attempt} 次）。', { time, attempt });
    }
    return t(ERROR_TEXT[account.lastError]);
  }
  const wake =
    account.wakeMode === 'all'
      ? t('全部新邮件')
      : t('仅匹配 {count} 条规则', { count: account.rules.length });
  const last =
    account.lastMailAt === null
      ? t('暂无新邮件')
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

const PROVIDER_CARD: Record<MailProvider, { name: string; description: string; info: string }> = {
  qq: {
    name: 'QQ 邮箱',
    description: '用授权码连接',
    info: '新邮件会唤醒 Coordinator，回信前先问你。',
  },
  gmail: {
    name: 'Gmail',
    description: '用应用专用密码连接',
    info: '新邮件会唤醒 Coordinator，回信前先问你。',
  },
  other: {
    name: '其他邮箱',
    description: 'Outlook、163 等支持 IMAP 的邮箱',
    info: '填好服务器即可连接，新邮件会唤醒 Coordinator，回信前先问你。',
  },
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const formatMailTime = (at: number) => {
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

export interface MailProviderCard {
  provider: MailProvider;
  name: string;
  description: string;
  info: string;
  connected: boolean;
  needsAttention: boolean;
  open: () => void;
}

function summarize(accounts: readonly MailAccountRecord[], t: Translate): string {
  const last = Math.max(0, ...accounts.map((account) => account.lastMailAt ?? 0));
  const lastText =
    last === 0 ? t('暂无新邮件') : t('最近一封 {time}', { time: formatMailTime(last) });
  const head =
    accounts.length === 1 ? (accounts[0]?.address ?? '') : t('{n} 个邮箱', { n: accounts.length });
  return `${head} · ${lastText}`;
}

function ManageMailboxDialog({
  provider,
  accounts,
  live,
  busy,
  onClose,
  onAdd,
  onRules,
  onRetry,
  onRemove,
}: {
  provider: MailProvider;
  accounts: readonly MailAccountRecord[];
  live: boolean;
  busy: boolean;
  onClose: () => void;
  onAdd: () => void;
  onRules: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t(PROVIDER_CARD[provider].name)}
      subtitle={t('回信前先问你')}
      info={t('Coordinator 回信前总会先给你看一张确认卡。')}
      onClose={onClose}
      footer={
        <Button className={DIALOG_PRIMARY_BUTTON} onClick={onAdd} data-testid="mail-add">
          {t('添加邮箱')}
        </Button>
      }
    >
      <ResourceList className="mt-0">
        {accounts.map((account) => (
          <ResourceRow key={account.id} data-testid={`mail-account-${account.id}`}>
            <RowText>
              <RowTitle>{account.address}</RowTitle>
              <RowDesc className="whitespace-normal tabular-nums">
                {describeAccount(account, t)}
              </RowDesc>
            </RowText>
            <StatusChip tone={MAIL_STATUS_TONE[account.status]}>
              {t(MAIL_STATUS_LABEL[account.status])}
            </StatusChip>
            {live && (
              <>
                {account.status === 'degraded' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onRetry(account.id)}
                    data-testid={`mail-retry-${account.id}`}
                  >
                    {t('立即重试')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRules(account.id)}
                  data-testid={`mail-rules-${account.id}`}
                >
                  {t('唤醒规则')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onRemove(account.id)}
                  data-testid={`mail-remove-${account.id}`}
                >
                  {t('删除')}
                </Button>
              </>
            )}
          </ResourceRow>
        ))}
      </ResourceList>
    </DialogShell>
  );
}

export function useMailConnectors({
  teamId,
  live,
  fixtureAccounts,
}: {
  teamId: string | undefined;
  live: boolean;
  fixtureAccounts: readonly MailAccountRecord[];
}): {
  cards: MailProviderCard[];
  dialogs: ReactNode;
  summaryOf: (provider: MailProvider) => string;
} {
  const { t } = useI18n();
  const accountsQ = useMailAccounts(teamId, live);
  const mutations = useMailMutations(teamId);
  const accounts = live ? (accountsQ.data?.accounts ?? []) : fixtureAccounts;
  const [managing, setManaging] = useState<MailProvider | null>(null);
  const [adding, setAdding] = useState<MailProvider | null>(null);
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MailAccountRecord | null>(null);
  const failed = (message: string) => (error: unknown) => toastError(t(message), error);
  const byProvider = (provider: MailProvider) =>
    accounts.filter((account) => mailProviderOf(account.address) === provider);
  const ruleAccount = accounts.find((account) => account.id === rulesFor);
  const managedAccounts = managing === null ? [] : byProvider(managing);

  const cards = MAIL_PROVIDERS.map((provider): MailProviderCard => {
    const own = byProvider(provider);
    return {
      provider,
      ...PROVIDER_CARD[provider],
      connected: own.length > 0,
      needsAttention: own.some(
        (account) => account.status === 'degraded' || account.status === 'revoked',
      ),
      open: () => (own.length > 0 ? setManaging(provider) : setAdding(provider)),
    };
  });

  const dialogs = (
    <>
      {managing !== null && managedAccounts.length > 0 && (
        <ManageMailboxDialog
          provider={managing}
          accounts={managedAccounts}
          live={live}
          busy={mutations.remove.isPending || mutations.retry.isPending}
          onClose={() => setManaging(null)}
          onAdd={() => setAdding(managing)}
          onRules={setRulesFor}
          onRetry={(id) =>
            mutations.retry.mutate(id, {
              onError: failed('立即重试失败，请重试。'),
            })
          }
          onRemove={(id) => {
            const target = managedAccounts.find((account) => account.id === id) ?? null;
            if (target !== null) setDeleting(target);
          }}
        />
      )}
      {adding !== null && (
        <AddMailboxDialog
          provider={adding}
          stacked={managing !== null && managedAccounts.length > 0}
          pending={mutations.connect.isPending || !live}
          onClose={() => setAdding(null)}
          onSubmit={(fields) =>
            mutations.connect.mutate(
              { ...fields, wakeMode: 'all' },
              {
                onSuccess: () => setAdding(null),
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
            mutations.addRule
              .mutateAsync({ id: ruleAccount.id, rule: { matchKind, pattern } })
              .then(
                () => undefined,
                (error: unknown) => {
                  failed('添加规则失败，请重试。')(error);
                  throw error;
                },
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
      <DeleteConfirm
        open={deleting !== null}
        title={t('删除后，该邮箱的凭据与唤醒规则都会移除，此操作无法撤销')}
        summary={deleting?.address ?? ''}
        ariaLabel={t('删除 {name}', { name: deleting?.address ?? '' })}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting === null) return;
          const target = deleting;
          setDeleting(null);
          mutations.remove.mutate(target.id, {
            onSuccess: () => managedAccounts.length === 1 && setManaging(null),
            onError: failed('删除失败，请重试。'),
          });
        }}
      />
    </>
  );

  return { cards, dialogs, summaryOf: (provider) => summarize(byProvider(provider), t) };
}

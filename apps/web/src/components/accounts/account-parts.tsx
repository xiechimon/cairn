import { cn } from 'cn';
import { ChevronRight, EllipsisVertical, PenLine, ShieldCheck, Trash2 } from 'lucide-react';
import { type ComponentType, type ReactNode, type SVGProps, useState } from 'react';
import type {
  AccountStep,
  AccountStepOutcome,
  AccountVendor,
  MachineProvider,
  MachineWithProviders,
  ProviderRuntime,
  QuotaWindow,
  StickyThread,
  SubscriptionAccount,
} from '../../api/claude-accounts.js';
import { ACCOUNT_VENDORS } from '../../api/claude-accounts.js';
import { relativeTime } from '../../board/rel-time.js';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { ACCENT_INK } from '../../phase.js';
import { ClaudeMark, GrokMark, OpenAIMark, PiMark } from '../brand-marks.js';
import { FORM_CONTROL_CLS } from '../form-layout.js';
import { ListRow } from '../list-card.js';
import { KeyedMenuContent, KeyedMenuItem } from '../menu-keys.js';
import { isLowQuota } from '../settings/quota-row.js';
import { SETTINGS_ROW_CLS, SettingsCard, SettingsSection } from '../settings-list.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { ToggleSwitch } from '../toggle-switch.js';
import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { Input } from '../ui/input.js';
import { StatusChip, type StatusTone } from '../ui/status-chip.js';

const DAY = 86_400_000;

type Mark = ComponentType<SVGProps<SVGSVGElement>>;

export const VENDORS: Record<AccountVendor, { label: string; short: string; Mark: Mark }> = {
  claude: { label: 'Claude', short: 'Claude', Mark: ClaudeMark },
  codex: { label: 'ChatGPT · Codex', short: 'Codex', Mark: OpenAIMark },
  grok: { label: 'Grok', short: 'Grok', Mark: GrokMark },
};

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5 小时',
  seven_day: '每周',
  billing_period: '计费周期',
};

const WINDOW_ORDER = ['five_hour', 'seven_day', 'billing_period'];

export const PROVIDERS: Record<ProviderRuntime, { label: string; Mark: Mark }> = {
  'claude-code': { label: 'Claude Code', Mark: ClaudeMark },
  codex: { label: 'Codex', Mark: OpenAIMark },
  pi: { label: 'pi', Mark: PiMark },
};

function useClock(): (ts: number, now: number) => string {
  const { locale } = useI18n();
  const tag = locale === 'en' ? 'en-US' : 'zh-CN';
  return (ts, now) =>
    new Intl.DateTimeFormat(
      tag,
      ts - now < DAY
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : ts - now < 6 * DAY
          ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
          : { month: 'short', day: 'numeric' },
    ).format(ts);
}

const leftPercent = (window: QuotaWindow) =>
  Math.max(0, Math.round((1 - window.utilization) * 100));

function recoversIn(ts: number, now: number, t: TFunc): string {
  const minutes = Math.max(1, Math.round((ts - now) / 60_000));
  if (minutes < 60) return t('{n} 分钟后恢复', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} 小时后恢复', { n: hours });
  return t('{n} 天后恢复', { n: Math.round(hours / 24) });
}

function accountStatus(
  account: SubscriptionAccount,
  now: number,
  t: TFunc,
  clock: (ts: number, now: number) => string,
): { dot: string; label: string } {
  switch (account.state) {
    case 'ok':
      return { dot: 'bg-running', label: t('可用') };
    case 'cooling':
      return {
        dot: 'bg-content-dim',
        label:
          account.cooldownUntil === null
            ? t('冷却中')
            : t('冷却至 {time}', { time: clock(account.cooldownUntil, now) }),
      };
    case 'exhausted':
      return {
        dot: 'bg-content-dim',
        label:
          account.cooldownUntil !== null && account.cooldownUntil > now
            ? `${t('额度用尽')} · ${recoversIn(account.cooldownUntil, now, t)}`
            : t('额度用尽'),
      };
    case 'expired':
      return { dot: 'bg-(--card-button)', label: t('已过期') };
  }
}

export function QuotaSection({
  windows,
  accounts,
  now,
}: {
  windows: string[];
  accounts: SubscriptionAccount[];
  now: number;
}) {
  const { t } = useI18n();
  const clock = useClock();
  return (
    <SettingsSection title={t('额度')}>
      <SettingsCard>
        {windows.map((name) => {
          const members = accounts.map((account, index) => ({
            account,
            index,
            window: account.windows.find((w) => w.name === name) ?? null,
          }));
          const reporting = members.flatMap((m) => (m.window === null ? [] : [m.window]));
          const left =
            reporting.length === 0
              ? null
              : Math.round(
                  reporting.reduce((sum, w) => sum + leftPercent(w), 0) / reporting.length,
                );
          const next = reporting
            .filter((w) => w.resetsAt !== null && w.utilization > 0)
            .sort((a, b) => (a.resetsAt ?? 0) - (b.resetsAt ?? 0))[0];
          const label = t(WINDOW_LABELS[name] ?? name);
          const meta = [
            ...(left === null ? [] : [t('剩余 {n}%', { n: left })]),
            ...(next?.resetsAt == null
              ? []
              : [
                  t('{time} 回补 {n}%', {
                    time: clock(next.resetsAt, now),
                    n: Math.round((Math.min(1, next.utilization) * 100) / reporting.length),
                  }),
                ]),
          ];
          return (
            <div
              key={name}
              data-testid="pool-window"
              data-window={name}
              className="flex flex-col divide-y divide-border"
            >
              <div className={cn(SETTINGS_ROW_CLS, 'gap-3')}>
                <span className="flex min-w-0 flex-col">
                  <span className="text-ui text-foreground">{label}</span>
                  <span className="text-meta text-content-tertiary tabular-nums">
                    {meta.length === 0 ? t('未上报') : meta.join(' · ')}
                  </span>
                </span>
                <span className="flex flex-none items-center justify-end @xl:w-56">
                  <span
                    role="progressbar"
                    aria-label={t('{window} 剩余', { window: label })}
                    aria-valuenow={left ?? undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className={cn(
                      'h-2 w-28 overflow-hidden rounded-full bg-secondary @xl:w-full',
                      left === null && 'border border-dashed border-border bg-transparent',
                    )}
                  >
                    {left !== null && (
                      <i
                        className={cn(
                          'block h-full rounded-full',
                          isLowQuota(left) ? 'bg-(--card-button)' : 'bg-running',
                        )}
                        style={{ width: `${left}%` }}
                      />
                    )}
                  </span>
                </span>
              </div>
              {members.map(({ account, index, window }) => {
                const pct = window === null ? null : leftPercent(window);
                const resets =
                  window?.resetsAt == null
                    ? null
                    : t('{time} 重置', { time: clock(window.resetsAt, now) });
                return (
                  <div
                    key={account.id}
                    data-testid="quota-account"
                    className={cn(SETTINGS_ROW_CLS, 'min-h-11 gap-3 py-1.5')}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-ui break-words text-foreground">{account.label}</span>
                      <span className="text-meta text-content-tertiary">
                        {t('优先级 {n}', { n: index + 1 })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex-none text-right text-meta text-content-secondary tabular-nums',
                        isLowQuota(pct) && ACCENT_INK,
                      )}
                    >
                      {pct === null
                        ? t('未上报')
                        : resets === null
                          ? `${pct}%`
                          : `${pct}% · ${resets}`}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}

export interface AccountRowActions {
  onRename?: (label: string) => void;
  onVerify?: () => void;
  onRemove: () => void;
}

export function AccountRow({
  account,
  index,
  now,
  actions,
  expanded,
  onToggleExpanded,
  status,
}: {
  account: SubscriptionAccount;
  index: number;
  now: number;
  actions: AccountRowActions;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  status?: ReactNode;
}) {
  const { t } = useI18n();
  const clock = useClock();
  const state = accountStatus(account, now, t, clock);
  const usage = [
    ...(account.lastUsedAt === null
      ? []
      : [t('最近使用 {ago}', { ago: relativeTime(account.lastUsedAt, now, t) })]),
    ...(account.stepsLast24h === null ? [] : [t('24 小时 {n} 步', { n: account.stepsLast24h })]),
  ];
  const meta = [
    ...(account.plan === null ? [] : [account.plan]),
    t('优先级 {n}', { n: index + 1 }),
    ...(usage.length === 0 ? [t('还没用过')] : usage),
  ];
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const next = draft?.trim() ?? '';
    if (next !== '' && next !== account.label) actions.onRename?.(next);
    setDraft(null);
  };
  return (
    <div
      data-testid="account-row"
      data-account-id={account.id}
      data-vendor={account.vendor}
      data-state={account.state}
      className={cn(SETTINGS_ROW_CLS, 'flex-nowrap gap-3')}
    >
      <span className="flex min-w-0 flex-auto items-center gap-2">
        {onToggleExpanded !== undefined && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-ml-1.5 flex-none text-content-tertiary"
            aria-expanded={expanded}
            aria-label={t('展开 {name}', { name: account.label })}
            onClick={onToggleExpanded}
          >
            <ChevronRight
              className={cn('transition-transform duration-(--dur-fast)', expanded && 'rotate-90')}
            />
          </Button>
        )}
        <span className="flex min-w-0 flex-auto flex-col">
          {draft === null ? (
            <span className="truncate text-ui text-foreground">{account.label}</span>
          ) : (
            <Input
              aria-label={t('账户名称')}
              data-testid="account-rename-input"
              className={cn(FORM_CONTROL_CLS, 'min-w-0 flex-auto')}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
                if (event.key === 'Escape') setDraft(null);
              }}
            />
          )}
          <span data-testid="account-meta" className="truncate text-meta text-content-tertiary">
            {meta.join(' · ')}
          </span>
        </span>
      </span>
      <span className="flex flex-none items-center justify-end gap-1 @xl:w-64">
        <span
          data-testid="account-status"
          className="flex min-w-0 items-center gap-1.5 text-meta text-content-secondary"
        >
          <span aria-hidden className={cn('size-1.5 flex-none rounded-full', state.dot)} />
          <span className="truncate max-sm:max-w-28">{state.label}</span>
        </span>
        {status}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="account-more"
                className="text-content-tertiary"
                aria-label={t('{name} 的操作', { name: account.label })}
              />
            }
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <KeyedMenuContent align="end" sideOffset={4} aria-label={t('更多')} className="w-44">
            {actions.onRename !== undefined && (
              <KeyedMenuItem
                shortcut="R"
                data-action="rename"
                onClick={() => setDraft(account.label)}
              >
                <PenLine />
                {t('重命名')}
              </KeyedMenuItem>
            )}
            {actions.onVerify !== undefined && (
              <KeyedMenuItem shortcut="V" data-action="verify" onClick={actions.onVerify}>
                <ShieldCheck />
                {t('验证')}
              </KeyedMenuItem>
            )}
            <KeyedMenuItem
              shortcut="D"
              confirms
              variant="destructive"
              data-action="remove"
              onClick={actions.onRemove}
            >
              <Trash2 />
              {t('移除')}
            </KeyedMenuItem>
          </KeyedMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

export function VendorSection({
  vendor,
  accounts,
  now,
  renderRow,
}: {
  vendor: AccountVendor;
  accounts: SubscriptionAccount[];
  now: number;
  renderRow: (account: SubscriptionAccount, index: number) => ReactNode;
}) {
  const { t } = useI18n();
  const { label } = VENDORS[vendor];
  const windows = WINDOW_ORDER.filter((name) =>
    accounts.some((a) => a.windows.some((w) => w.name === name)),
  );
  return (
    <section data-testid="vendor-section" data-vendor={vendor} className="flex flex-col gap-3">
      {accounts.length === 0 ? (
        <SettingsCard>
          <div className={cn(SETTINGS_ROW_CLS, 'text-meta text-content-tertiary')}>
            {t('还没有 {vendor} 账户', { vendor: label })}
          </div>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard>{accounts.map((account, index) => renderRow(account, index))}</SettingsCard>
          {windows.length > 0 && <QuotaSection windows={windows} accounts={accounts} now={now} />}
          {windows.length === 0 && (
            <p className="m-0 text-meta text-content-tertiary">{t('还没有额度读数')}</p>
          )}
        </>
      )}
    </section>
  );
}

export function VendorList({
  value,
  counts,
  onChange,
}: {
  value: AccountVendor;
  counts: Record<AccountVendor, number>;
  onChange: (vendor: AccountVendor) => void;
}) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('订阅账户')}
      data-testid="vendor-list"
      className="flex w-full flex-none flex-col border-b border-border @3xl:w-64 @3xl:border-r @3xl:border-b-0"
    >
      {ACCOUNT_VENDORS.map((vendor) => {
        const { label, short, Mark } = VENDORS[vendor];
        const selected = vendor === value;
        return (
          <Button
            key={vendor}
            variant="ghost"
            aria-current={selected ? 'true' : undefined}
            aria-label={`${short} ${counts[vendor]}`}
            data-vendor={vendor}
            onClick={() => onChange(vendor)}
            className="h-auto w-full justify-start gap-2.5 rounded-none border-x-0 border-t-0 border-b border-border px-3.5 py-2.5 text-left first:rounded-t-(--radius-card) last:rounded-b-(--radius-card) font-normal whitespace-normal outline-none transition-colors duration-(--dur-fast) last:border-b-0 hover:bg-menu-hover focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset aria-[current=true]:bg-secondary"
          >
            <Mark
              aria-hidden
              width={16}
              height={16}
              className="block flex-none text-content-secondary [&_path]:fill-current"
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ui font-medium text-foreground">{label}</span>
              <span className="truncate text-meta text-content-tertiary">
                {t('{n} 个账户', { n: counts[vendor] })}
              </span>
            </span>
          </Button>
        );
      })}
    </nav>
  );
}

const OUTCOME_GLYPH: Record<AccountStepOutcome, { kind: GlyphKind; className: string }> = {
  running: { kind: 'working', className: 'text-running' },
  done: { kind: 'done', className: 'text-running' },
  failed: { kind: 'failed', className: 'text-destructive' },
  'rejected-rerun': { kind: 'closed', className: 'text-content-tertiary' },
};

const OUTCOME_LABELS: Record<AccountStepOutcome, string> = {
  running: '运行中',
  done: '完成',
  failed: '失败',
  'rejected-rerun': '驳回重跑',
};

const STEP_KIND_LABELS: Record<AccountStep['kind'], string> = {
  build: '构建',
  plan: '方案',
  chief: 'Coordinator',
  review: '评审',
  merge: '合并',
};

export function AccountStepRow({ step, now }: { step: AccountStep; now: number }) {
  const { t } = useI18n();
  const glyph = OUTCOME_GLYPH[step.outcome];
  const kind = t(STEP_KIND_LABELS[step.kind]);
  return (
    <ListRow
      className="hover:bg-transparent"
      icon={
        <StatusGlyph
          kind={glyph.kind}
          className={glyph.className}
          label={t(OUTCOME_LABELS[step.outcome])}
        />
      }
      title={step.title ?? t('{kind} 步骤', { kind })}
      subtitle={kind}
      trailing={relativeTime(step.startedAt, now, t)}
    />
  );
}

export function StickyThreadRow({ thread, now }: { thread: StickyThread; now: number }) {
  const { t } = useI18n();
  return (
    <ListRow
      className="hover:bg-transparent"
      title={thread.title}
      trailing={t('固定于 {ago}', { ago: relativeTime(thread.since, now, t) })}
    />
  );
}

const LOGIN_CHIP: Record<MachineProvider['login'], { tone: StatusTone; label: string }> = {
  'logged-in': { tone: 'done', label: '已登录' },
  'logged-out': { tone: 'confirm', label: '未登录' },
  unknown: { tone: 'idle', label: '状态未知' },
};

export function ProviderRow({
  provider,
  toggleable,
  pending = false,
  onToggle,
}: {
  provider: MachineProvider;
  toggleable: boolean;
  pending?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const chip = LOGIN_CHIP[provider.login];
  const { label: name, Mark } = PROVIDERS[provider.runtime];
  const meta = [provider.plan, provider.version].filter((part): part is string => part !== null);
  return (
    <div
      data-testid="provider-row"
      data-runtime={provider.runtime}
      data-login={provider.login}
      className={cn(SETTINGS_ROW_CLS, 'flex-wrap justify-start gap-x-4 gap-y-1')}
    >
      <span className="flex w-32 flex-none items-center gap-2 text-ui text-foreground">
        <Mark width={16} height={16} className="flex-none text-foreground" />
        {name}
      </span>
      <StatusChip tone={chip.tone} className="flex-none">
        {t(chip.label)}
      </StatusChip>
      <span className="flex min-w-0 flex-auto items-center gap-3 text-meta text-content-tertiary">
        {meta.length > 0 && <span className="truncate font-mono">{meta.join(' · ')}</span>}
        {provider.login === 'logged-out' && provider.loginCommand !== null && (
          <span className="truncate">
            {t('在这台机器上运行')}{' '}
            <code
              data-testid="provider-login-command"
              className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-code text-foreground"
            >
              {provider.loginCommand}
            </code>
          </span>
        )}
      </span>
      <ToggleSwitch
        className="ml-auto"
        data-testid="provider-toggle"
        aria-label={t('{name} 接任务', { name })}
        checked={provider.enabled}
        disabled={!toggleable || pending}
        title={toggleable ? undefined : t('这台机器还不能单独开关 {name}', { name })}
        onCheckedChange={(next) => onToggle(next)}
      />
    </div>
  );
}

export function MachineProvidersCard({
  machine,
  toggleable,
  pendingRuntime,
  onToggle,
  online,
}: {
  machine: MachineWithProviders;
  toggleable: (runtime: ProviderRuntime) => boolean;
  pendingRuntime?: ProviderRuntime | null;
  onToggle: (runtime: ProviderRuntime, next: boolean) => void;
  online: ReactNode;
}) {
  const { t } = useI18n();
  const providers = machine.providers ?? [];
  return (
    <section
      data-testid="machine-providers"
      data-machine-id={machine.id}
      className="flex flex-col gap-2"
    >
      <header className="flex items-center gap-3 px-1">
        <h3 className="m-0 truncate text-ui font-semibold text-foreground">{machine.name}</h3>
        {online}
      </header>
      <SettingsCard>
        {providers.length === 0 ? (
          <div className={cn(SETTINGS_ROW_CLS, 'text-meta text-content-tertiary')}>
            {t('这台机器还没有上报 provider 状态')}
          </div>
        ) : (
          providers.map((provider) => (
            <ProviderRow
              key={provider.runtime}
              provider={provider}
              toggleable={toggleable(provider.runtime)}
              pending={pendingRuntime === provider.runtime}
              onToggle={(next) => onToggle(provider.runtime, next)}
            />
          ))
        )}
      </SettingsCard>
    </section>
  );
}

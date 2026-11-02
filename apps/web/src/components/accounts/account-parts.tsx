import { cn } from 'cn';
import { ChevronRight, EllipsisVertical, PenLine, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { type ComponentType, type ReactNode, type SVGProps, useState } from 'react';
import type {
  AccountStep,
  AccountStepOutcome,
  AccountVendor,
  QuotaWindow,
  StickyThread,
  SubscriptionAccount,
} from '../../api/claude-accounts.js';
import { ACCOUNT_VENDORS } from '../../api/claude-accounts.js';
import { ProjectAvatar } from '../../board/project-avatar.js';
import { relativeTime } from '../../board/rel-time.js';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { ACCENT_INK } from '../../phase.js';
import { ClaudeMark, GrokMark, OpenAIMark } from '../brand-marks.js';
import { FORM_CONTROL_CLS } from '../form-layout.js';
import { ListRow } from '../list-card.js';
import { KeyedMenuContent, KeyedMenuItem } from '../menu-keys.js';
import { SegmentedTabs } from '../segmented.js';
import { isLowQuota } from '../settings/quota-row.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../settings-list.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { Badge } from '../ui/badge.js';
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

const SEGMENT_FILL = [
  'bg-project-tile-1',
  'bg-project-tile-2',
  'bg-project-tile-3',
  'bg-project-tile-4',
  'bg-project-tile-5',
  'bg-project-tile-6',
] as const;

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

function accountChip(
  account: SubscriptionAccount,
  now: number,
  t: TFunc,
  clock: (ts: number, now: number) => string,
): { tone: StatusTone; label: string } {
  switch (account.state) {
    case 'ok':
      return { tone: 'done', label: t('可用') };
    case 'cooling':
      return {
        tone: 'idle',
        label:
          account.cooldownUntil === null
            ? t('冷却中')
            : t('冷却至 {time}', { time: clock(account.cooldownUntil, now) }),
      };
    case 'exhausted':
      return { tone: 'idle', label: t('额度用尽') };
    case 'expired':
      return { tone: 'confirm', label: t('已过期') };
  }
}

export function AccountStateChip({ account, now }: { account: SubscriptionAccount; now: number }) {
  const { t } = useI18n();
  const clock = useClock();
  const chip = accountChip(account, now, t, clock);
  return (
    <StatusChip tone={chip.tone} className="flex-none">
      {chip.label}
    </StatusChip>
  );
}

export function PoolWindowCard({
  name,
  accounts,
  now,
}: {
  name: string;
  accounts: SubscriptionAccount[];
  now: number;
}) {
  const { t } = useI18n();
  const clock = useClock();
  const members = accounts.map((account, index) => ({
    account,
    index,
    window: account.windows.find((w) => w.name === name) ?? null,
  }));
  const reporting = members.flatMap((m) => (m.window === null ? [] : [m.window]));
  const left =
    reporting.length === 0
      ? null
      : Math.round(reporting.reduce((sum, w) => sum + leftPercent(w), 0) / reporting.length);
  const next = reporting
    .filter((w) => w.resetsAt !== null && w.utilization > 0)
    .sort((a, b) => (a.resetsAt ?? 0) - (b.resetsAt ?? 0))[0];
  const label = t(WINDOW_LABELS[name] ?? name);
  return (
    <div
      data-testid="pool-window"
      data-window={name}
      className="grid items-center gap-x-6 gap-y-3 rounded-(--radius-card) bg-card px-4 py-3 shadow-(--e1) md:grid-cols-[10rem_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-ui font-medium text-foreground">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'text-page font-semibold text-foreground tabular-nums',
              isLowQuota(left) && ACCENT_INK,
            )}
          >
            {left === null ? '—' : `${left}%`}
          </span>
          <span className="text-meta text-content-tertiary">{t('剩余')}</span>
        </span>
        {next?.resetsAt != null && (
          <span className="text-caption text-content-tertiary tabular-nums">
            {t('{time} 回补 {n}%', {
              time: clock(next.resetsAt, now),
              n: Math.round((Math.min(1, next.utilization) * 100) / reporting.length),
            })}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div
          className="grid gap-x-3"
          style={{ gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))` }}
        >
          {members.map(({ account, index, window }) => {
            const pct = window === null ? null : leftPercent(window);
            return (
              <div
                key={account.id}
                role="progressbar"
                aria-label={t('{name} {window} 剩余', { name: account.label, window: label })}
                aria-valuenow={pct ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                className={cn(
                  'h-2 overflow-hidden rounded-full bg-secondary',
                  window === null && 'border border-dashed border-border bg-transparent',
                )}
              >
                {pct !== null && (
                  <i
                    className={cn(
                      'block h-full rounded-full',
                      SEGMENT_FILL[index % SEGMENT_FILL.length],
                    )}
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div
          className="flex flex-col gap-1 md:grid md:gap-x-3"
          style={{ gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))` }}
        >
          {members.map(({ account, index, window }) => {
            const pct = window === null ? null : leftPercent(window);
            const resets =
              window?.resetsAt == null
                ? null
                : t('{time} 重置', { time: clock(window.resetsAt, now) });
            return (
              <div
                key={account.id}
                className="flex min-w-0 items-center gap-x-1.5 gap-y-1 text-caption text-content-tertiary md:flex-col md:items-stretch"
              >
                <span className="flex min-w-0 flex-auto items-center gap-1.5 md:flex-none">
                  <ProjectAvatar name={String(index + 1)} tone={index} />
                  <span className="truncate text-content-secondary">{account.label}</span>
                  <span
                    className={cn('ml-auto flex-none tabular-nums', isLowQuota(pct) && ACCENT_INK)}
                  >
                    {pct === null ? t('未上报') : `${pct}%`}
                  </span>
                </span>
                {resets !== null && (
                  <span className="flex-none truncate tabular-nums">{resets}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-ui text-foreground tabular-nums">{value}</span>
      <span className="text-caption text-content-tertiary">{label}</span>
    </span>
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
      className={cn(SETTINGS_ROW_CLS, 'flex-wrap justify-start gap-x-6 gap-y-2 py-2.5')}
    >
      <span className="flex min-w-0 flex-auto items-center gap-2.5 sm:w-72 sm:flex-none">
        {onToggleExpanded !== undefined ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-ml-1.5 text-content-tertiary"
            aria-expanded={expanded}
            aria-label={t('展开 {name}', { name: account.label })}
            onClick={onToggleExpanded}
          >
            <ChevronRight
              className={cn('transition-transform duration-(--dur-fast)', expanded && 'rotate-90')}
            />
          </Button>
        ) : (
          <span aria-hidden className="w-4.5 flex-none" />
        )}
        <ProjectAvatar name={String(index + 1)} tone={index} />
        {draft === null ? (
          <span className="truncate text-ui font-semibold text-foreground">{account.label}</span>
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
        {account.plan !== null && draft === null && (
          <Badge variant="outline" className="flex-none">
            {account.plan}
          </Badge>
        )}
      </span>
      <span className="w-40 flex-none">
        <AccountStateChip account={account} now={now} />
      </span>
      <span className="grid grid-cols-2 gap-x-6">
        <Stat
          value={account.lastUsedAt === null ? '—' : relativeTime(account.lastUsedAt, now, t)}
          label={t('最近使用')}
        />
        <Stat
          value={account.stepsLast24h === null ? '—' : String(account.stepsLast24h)}
          label={t('24 小时步骤')}
        />
      </span>
      <span className="ml-auto flex items-center gap-2">
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
          {windows.length > 0 ? (
            windows.map((name) => (
              <PoolWindowCard key={name} name={name} accounts={accounts} now={now} />
            ))
          ) : (
            <p className="m-0 px-1 text-meta text-content-tertiary">{t('还没有额度读数')}</p>
          )}
          <SettingsCard>{accounts.map((account, index) => renderRow(account, index))}</SettingsCard>
        </>
      )}
    </section>
  );
}

export function VendorTabs({
  value,
  counts,
  onChange,
  onAdd,
}: {
  value: AccountVendor;
  counts: Record<AccountVendor, number>;
  onChange: (vendor: AccountVendor) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <SegmentedTabs
        label={t('订阅账户')}
        value={value}
        onChange={onChange}
        className="min-w-0"
        options={ACCOUNT_VENDORS.map((vendor) => {
          const { short, Mark } = VENDORS[vendor];
          return {
            value: vendor,
            label: `${short} ${counts[vendor]}`,
            icon: <Mark width={14} height={14} className="block flex-none text-foreground" />,
            data: { 'data-vendor': vendor },
          };
        })}
      />
      <Button
        variant="ghost"
        className="ml-auto flex-none"
        aria-label={t('添加 {vendor} 账户', { vendor: VENDORS[value].label })}
        onClick={onAdd}
      >
        <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
        <span className="hidden sm:inline">{t('添加账户')}</span>
      </Button>
    </div>
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

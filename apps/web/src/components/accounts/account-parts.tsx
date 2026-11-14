import { cn } from 'cn';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import type {
  AccountStep,
  AccountStepOutcome,
  AccountVendor,
  MachineProvider,
  MachineWithProviders,
  ProviderRuntime,
  StickyThread,
} from '../../api/claude-accounts.js';
import { relativeTime } from '../../board/rel-time.js';
import { useI18n } from '../../i18n/provider.js';
import { ClaudeMark, GrokMark, OpenAIMark, PiMark } from '../brand-marks.js';
import { ListRow } from '../list-card.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../settings-list.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { ToggleSwitch } from '../toggle-switch.js';
import { StatusChip, type StatusTone } from '../ui/status-chip.js';

const DAY = 86_400_000;

type Mark = ComponentType<SVGProps<SVGSVGElement>>;

export const VENDORS: Record<AccountVendor, { label: string; short: string; Mark: Mark }> = {
  claude: { label: 'Claude', short: 'Claude', Mark: ClaudeMark },
  codex: { label: 'ChatGPT · Codex', short: 'Codex', Mark: OpenAIMark },
  grok: { label: 'Grok', short: 'Grok', Mark: GrokMark },
};

export const PROVIDERS: Record<ProviderRuntime, { label: string; Mark: Mark }> = {
  'claude-code': { label: 'Claude Code', Mark: ClaudeMark },
  codex: { label: 'Codex', Mark: OpenAIMark },
  pi: { label: 'pi', Mark: PiMark },
};

export function useClock(): (ts: number, now: number) => string {
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
      trailing={
        relativeTime(thread.since, now, t) === ''
          ? undefined
          : t('固定于 {ago}', { ago: relativeTime(thread.since, now, t) })
      }
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
            {t('在这台 Runner 上运行')}{' '}
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
        title={toggleable ? undefined : t('这台 Runner 还不能单独开关 {name}', { name })}
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
            {t('这台 Runner 还没有上报 provider 状态')}
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

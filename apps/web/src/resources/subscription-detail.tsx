import {
  MODEL_SOURCE_RUNTIME_LABELS,
  type ModelSource,
  type ModelSourceModel,
  type ModelSourceRuntime,
} from '@cairn/shared';
import { cn } from 'cn';
import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AccountStatus, Verification, VerifyFailure } from '../api/account-verification.js';
import type {
  AccountVendor,
  QuotaWindow,
  SubscriptionAccount,
  SubscriptionModel,
} from '../api/claude-accounts.js';
import { relativeTime } from '../board/rel-time.js';
import { useClock, VENDORS } from '../components/accounts/account-parts.js';
import { withCodeSpans } from '../components/notice-banner.js';
import {
  ProviderEditorHead,
  type ProviderTone,
  TONE_DOT,
} from '../components/providers/provider-panel.js';
import { isLowQuota } from '../components/settings/quota-row.js';
import {
  SETTINGS_ROW_CLS,
  SettingsCard,
  SettingsDangerZone,
  SettingsRow,
  SettingsSection,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from '../components/ui/popover.js';
import { Spinner } from '../components/ui/spinner.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ACCENT_INK } from '../phase.js';
import { CommitInput } from './provider-editors.js';
import { COST_TIER_LABEL } from './upstream-model-picker.js';

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5 小时',
  seven_day: '每周',
  billing_period: '计费周期',
};

const WINDOW_ORDER = ['five_hour', 'seven_day', 'billing_period'];

const AUTH_RENEWAL: Record<AccountVendor, string> = {
  claude:
    '这个订阅的登录已失效。先移除它，再在终端运行 `claude setup-token`，把新的 token 添加回来。',
  codex: '这个订阅的登录已失效。先移除它，再重新添加新的 token。',
  grok: '这个订阅的登录已失效。先移除它，再重新添加新的 token。',
  devin:
    '这个订阅的登录已失效。先移除它，再运行 `cat ~/.local/share/devin/credentials.toml` 把输出整个添加回来。',
  antigravity:
    '这个订阅的登录已失效。在执行机重新登录 Google 账号或更新 API Key 后，移除并重新添加。',
};

const EXPIRED_RENEWAL: Record<AccountVendor, string> = {
  claude: '这个订阅已过期。先移除它，再在终端运行 `claude setup-token`，把新的 token 添加回来。',
  codex: '这个订阅已过期。先移除它，再重新添加新的 token。',
  grok: '这个订阅已过期。先移除它，再重新添加新的 token。',
  devin:
    '这个订阅已过期。先移除它，再运行 `cat ~/.local/share/devin/credentials.toml` 把输出整个添加回来。',
  antigravity: '这个订阅已过期。在执行机重新登录 Google 账号或更新 API Key 后，移除并重新添加。',
};

const UNAVAILABLE_COPY: Record<AccountVendor, string> = {
  claude: '服务器上找不到 claude 命令',
  codex: '服务器上找不到 codex 命令',
  grok: '服务器上找不到可执行的 agent',
  devin: '服务器上找不到 devin 命令',
  antigravity: '服务器上找不到 agy 命令',
};

function failureCopy(vendor: AccountVendor): Record<VerifyFailure, string> {
  return {
    auth: AUTH_RENEWAL[vendor],
    timeout: '验证超时，请重试',
    unavailable: UNAVAILABLE_COPY[vendor],
    quota: '模型额度已用尽，请等待额度恢复后重试。',
    failed: '验证没有通过，请重试',
    network: '连接中断，服务器可能正在重启，请重试',
    'rate-limited': '验证太频繁，请 10 秒后重试',
    missing_local_login:
      '执行机上还没有登录 Antigravity，请先运行 `agy acp --login` 或改用 API Key',
  };
}

const VERIFYING_COPY: Record<AccountVendor, string> = {
  claude: '正在用这个订阅发一次模型请求',
  codex: '正在检查这个订阅的登录',
  grok: '正在检查这个订阅的登录',
  devin: '正在用这个凭据登录 Devin',
  antigravity: '正在检查 Antigravity 是否接受这个凭据',
};

const PASSED_COPY: Record<AccountVendor, string> = {
  claude: '这个订阅刚完成了一次模型请求。',
  codex: '这个订阅的登录有效。',
  grok: '这个订阅的登录有效。',
  devin: 'Devin 接受了这个凭据。',
  antigravity: 'Antigravity 接受了这个凭据。',
};

const STATUS_CLS = 'flex items-center gap-1.5 text-meta text-content-secondary';
const STATUS_DOT_CLS = 'size-1.5 flex-none rounded-full';

export interface SubscriptionStatusView {
  tone: ProviderTone;
  label: string;
  reason: string | null;
}

const DAY = 86_400_000;

function recoversIn(ts: number, now: number, t: TFunc): string {
  const minutes = Math.max(1, Math.round((ts - now) / 60_000));
  if (minutes < 60) return t('{n} 分钟后恢复', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} 小时后恢复', { n: hours });
  return t('{n} 天后恢复', { n: Math.round((hours * 3_600_000) / DAY) });
}

export function subscriptionStatusView(
  account: SubscriptionAccount,
  status: AccountStatus,
  now: number,
  t: TFunc,
  clock: (ts: number, now: number) => string,
): SubscriptionStatusView {
  if (status.kind === 'verifying') return { tone: 'off', label: t('验证中…'), reason: null };
  if (status.kind === 'verify-failed') return { tone: 'fail', label: t('验证失败'), reason: null };
  switch (status.state) {
    case 'ok':
      return { tone: 'ok', label: t('可用'), reason: null };
    case 'cooling':
      return {
        tone: 'off',
        label:
          account.cooldownUntil === null
            ? t('冷却中')
            : t('冷却至 {time}', { time: clock(account.cooldownUntil, now) }),
        reason: null,
      };
    case 'exhausted':
      return {
        tone: 'off',
        label: t('额度用尽'),
        reason:
          account.cooldownUntil !== null && account.cooldownUntil > now
            ? recoversIn(account.cooldownUntil, now, t)
            : null,
      };
    case 'expired':
      return {
        tone: 'warn',
        label: t('已过期'),
        reason: t(EXPIRED_RENEWAL[account.vendor]),
      };
  }
}

const leftPercent = (window: QuotaWindow) =>
  Math.max(0, Math.round((1 - window.utilization) * 100));

const SUBSCRIPTION_RUNTIME: Partial<Record<AccountVendor, ModelSourceRuntime>> = {
  claude: 'claude-code',
  devin: 'devin',
  antigravity: 'antigravity',
};

export function subscriptionModels(
  sources: readonly ModelSource[],
  vendor: AccountVendor,
): ModelSourceModel[] {
  const runtime = SUBSCRIPTION_RUNTIME[vendor];
  if (runtime === undefined) return [];
  const byId = new Map<string, ModelSourceModel>();
  for (const source of sources) {
    if (source.runtime !== runtime || !source.installed) continue;
    for (const model of source.models) {
      if (model.id === '') continue;
      const prev = byId.get(model.id);
      if (prev === undefined || (model.liveness === 'dead' && prev.liveness !== 'dead')) {
        byId.set(model.id, model);
      }
    }
  }
  return [...byId.values()];
}

export function subscriptionRowTone(
  view: SubscriptionStatusView,
  models: readonly ModelSourceModel[],
): ProviderTone {
  if (view.tone === 'fail') return 'fail';
  if (models.length === 0 || models.some((model) => model.liveness === 'dead')) return 'warn';
  return view.tone;
}

export function subscriptionSummary(
  account: SubscriptionAccount,
  view: SubscriptionStatusView,
  models: readonly ModelSourceModel[],
  now: number,
  t: TFunc,
): string {
  const retired = models.filter((model) => model.liveness === 'dead').length;
  return [
    t('订阅'),
    ...(account.plan === null ? [] : [account.plan]),
    t('{n} 个模型', { n: models.length }),
    ...(retired === 0 ? [] : [t('{n} 个已下架', { n: retired })]),
    view.label,
    ...(account.lastUsedAt === null || view.tone !== 'ok'
      ? []
      : [t('最近使用 {ago}', { ago: relativeTime(account.lastUsedAt, now, t) })]),
  ].join(' · ');
}

function QuotaRows({ windows, now }: { windows: QuotaWindow[]; now: number }) {
  const { t } = useI18n();
  const clock = useClock();
  const ordered = WINDOW_ORDER.flatMap((name) => windows.filter((w) => w.name === name));
  if (ordered.length === 0) {
    return (
      <div className={cn(SETTINGS_ROW_CLS, 'text-meta text-content-tertiary')}>
        {t('还没有额度读数')}
      </div>
    );
  }
  return ordered.map((window) => {
    const left = leftPercent(window);
    const label = t(WINDOW_LABELS[window.name] ?? window.name);
    return (
      <SettingsRow
        key={window.name}
        label={label}
        hint={
          window.resetsAt === null
            ? undefined
            : t('{time} 重置', { time: clock(window.resetsAt, now) })
        }
        className="gap-3"
      >
        <span
          role="progressbar"
          aria-label={t('{window} 剩余', { window: label })}
          aria-valuenow={left}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-28 flex-none overflow-hidden rounded-full bg-secondary @xl:w-40"
        >
          <i
            className={cn(
              'block h-full rounded-full',
              isLowQuota(left) ? 'bg-(--card-button)' : 'bg-running',
            )}
            style={{ width: `${left}%` }}
          />
        </span>
        <span
          className={cn(
            'w-10 flex-none text-right text-meta text-content-secondary tabular-nums',
            isLowQuota(left) && ACCENT_INK,
          )}
        >
          {left}%
        </span>
      </SettingsRow>
    );
  });
}

export interface SubscriptionActions {
  onVerify?: () => void;
  onRename?: (label: string) => void;
  onRemove: () => void;
  onPickUpstream?: () => void;
  onRemoveModel?: (id: string) => void;
  modelsBusy?: boolean;
}

function SubscriptionModelChip({ model }: { model: ModelSourceModel }) {
  const { t } = useI18n();
  const dead = model.liveness === 'dead';
  return (
    <span
      data-testid="subscription-model"
      data-model-id={model.id}
      data-liveness={dead ? 'dead' : 'alive'}
      className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md bg-secondary px-2.5 py-0.5 text-ui text-foreground ring-1 ring-border pointer-coarse:min-h-9"
    >
      <span
        className={cn(
          'min-w-0 [overflow-wrap:anywhere]',
          dead && 'text-content-tertiary line-through',
        )}
      >
        {model.name}
      </span>
      {model.name !== model.id && (
        <code className="flex-none truncate font-mono text-caption text-content-tertiary">
          {model.id}
        </code>
      )}
      {dead && <span className="flex-none text-meta text-content-tertiary">{t('已下架')}</span>}
    </span>
  );
}

function PickedModelChip({
  model,
  busy,
  onRemove,
}: {
  model: SubscriptionModel;
  busy: boolean;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const dead = model.liveness === 'dead';
  const tier =
    model.costTier === undefined ? undefined : (COST_TIER_LABEL[model.costTier] ?? model.costTier);
  const context =
    model.contextTokens === undefined
      ? undefined
      : model.contextTokens >= 1_000_000
        ? `${Number((model.contextTokens / 1_000_000).toFixed(1))}M`
        : `${Math.round(model.contextTokens / 1000)}K`;
  return (
    <span
      data-testid="subscription-picked-model"
      data-model-id={model.id}
      title={model.costSummary}
      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-secondary pl-2.5 pr-1 text-ui text-foreground ring-1 ring-border"
    >
      <span className={cn('truncate', dead && 'text-content-tertiary line-through')}>
        {model.name}
      </span>
      {model.name !== model.id && (
        <code className="truncate font-mono text-caption text-content-tertiary">{model.id}</code>
      )}
      {model.costTier === 'Free' && (
        <span
          data-testid="subscription-model-free"
          className="flex-none rounded border border-border px-1 text-caption text-content-tertiary"
        >
          Free
        </span>
      )}
      {tier !== undefined && model.costTier !== 'Free' && (
        <span className="flex-none text-caption text-content-tertiary">{t(tier)}</span>
      )}
      {context !== undefined && (
        <span className="flex-none text-caption text-content-tertiary tabular-nums">{context}</span>
      )}
      {dead && <span className="flex-none text-caption text-content-tertiary">{t('已下架')}</span>}
      {onRemove !== undefined && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('移除模型')}
          data-testid="subscription-model-remove"
          disabled={busy}
          className="size-5 text-content-tertiary"
          onClick={onRemove}
        >
          <X />
        </Button>
      )}
    </span>
  );
}

function VerifyFeedback({
  vendor,
  verification,
}: {
  vendor: AccountVendor;
  verification: Verification;
}) {
  const { t } = useI18n();
  return (
    <PopoverDescription
      role="status"
      className="flex items-start gap-2 text-meta text-content-secondary"
    >
      {verification.phase === 'verifying' && (
        <Spinner aria-hidden className="mt-0.5 size-4 flex-none text-content-tertiary" />
      )}
      <span>
        {withCodeSpans(
          verification.phase === 'verifying'
            ? t(VERIFYING_COPY[vendor])
            : verification.phase === 'passed'
              ? t(PASSED_COPY[vendor])
              : t(failureCopy(vendor)[verification.reason]),
        )}
      </span>
    </PopoverDescription>
  );
}

export function SubscriptionDetail({
  account,
  models,
  picked,
  now,
  view,
  verification,
  actions,
}: {
  account: SubscriptionAccount;
  models: readonly ModelSourceModel[];
  picked?: readonly SubscriptionModel[];
  now: number;
  view: SubscriptionStatusView;
  verification: Verification | undefined;
  actions: SubscriptionActions;
}) {
  const { t } = useI18n();
  const verifyRef = useRef<HTMLButtonElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(verification?.phase === 'verifying');
  useEffect(() => {
    if (verification?.phase === 'verifying') setFeedbackOpen(true);
  }, [verification]);
  const neverUsed = account.lastUsedAt === null && account.stepsLast24h === null;
  const runtime = SUBSCRIPTION_RUNTIME[account.vendor];
  const runtimeLabel =
    runtime === undefined ? VENDORS[account.vendor].label : MODEL_SOURCE_RUNTIME_LABELS[runtime];
  return (
    <>
      <ProviderEditorHead
        Mark={VENDORS[account.vendor].Mark}
        name={account.label}
        kind={[t('订阅'), ...(account.plan === null ? [] : [account.plan])].join(' · ')}
      />
      <div
        data-testid="subscription-detail"
        data-account-id={account.id}
        data-tone={view.tone}
        className="flex flex-col gap-6"
      >
        <SettingsCard>
          <SettingsRow label={t('状态')}>
            <Popover open={feedbackOpen} onOpenChange={setFeedbackOpen}>
              {verification?.phase === 'failed' ? (
                <PopoverTrigger
                  data-testid="subscription-status"
                  aria-label={t('查看验证结果：{status}', { status: view.label })}
                  className={cn(STATUS_CLS, 'rounded-sm hover:text-foreground')}
                >
                  <span aria-hidden className={cn(STATUS_DOT_CLS, TONE_DOT[view.tone])} />
                  {view.label}
                </PopoverTrigger>
              ) : (
                <span data-testid="subscription-status" className={STATUS_CLS}>
                  <span aria-hidden className={cn(STATUS_DOT_CLS, TONE_DOT[view.tone])} />
                  {view.label}
                </span>
              )}
              {actions.onVerify !== undefined && (
                <Button
                  ref={verifyRef}
                  variant="outline"
                  size="sm"
                  data-testid="subscription-verify"
                  disabled={verification?.phase === 'verifying'}
                  onClick={actions.onVerify}
                >
                  {view.tone === 'fail' ? t('重试') : t('验证')}
                </Button>
              )}
              {verification !== undefined && (
                <PopoverContent
                  anchor={verifyRef}
                  align="end"
                  sideOffset={8}
                  initialFocus={false}
                  finalFocus={verifyRef}
                  data-testid="subscription-verify-feedback"
                  data-phase={verification.phase}
                  className="p-3"
                >
                  <VerifyFeedback vendor={account.vendor} verification={verification} />
                </PopoverContent>
              )}
            </Popover>
          </SettingsRow>
          {view.reason !== null && (
            <div
              data-testid="subscription-reason"
              className={cn(SETTINGS_ROW_CLS, 'min-h-0 py-2 text-meta text-content-tertiary')}
            >
              <span>{withCodeSpans(view.reason)}</span>
            </div>
          )}
          {actions.onRename !== undefined && (
            <SettingsRow label={t('名称')} className="flex-wrap gap-y-2 py-2.5">
              <CommitInput
                key={`label:${account.label}`}
                label={t('名称')}
                value={account.label}
                onCommit={actions.onRename}
              />
            </SettingsRow>
          )}
          {neverUsed ? (
            <SettingsRow label={t('使用')}>
              <span className="text-meta text-content-tertiary">{t('还没用过')}</span>
            </SettingsRow>
          ) : (
            <>
              {account.lastUsedAt !== null && (
                <SettingsRow label={t('最近使用')}>
                  <span className="text-meta text-content-secondary">
                    {relativeTime(account.lastUsedAt, now, t)}
                  </span>
                </SettingsRow>
              )}
              {account.stepsLast24h !== null && (
                <SettingsRow label={t('24 小时步骤')}>
                  <span className="text-meta text-content-secondary tabular-nums">
                    {account.stepsLast24h}
                  </span>
                </SettingsRow>
              )}
            </>
          )}
        </SettingsCard>
        {picked === undefined ? (
          <SettingsSection title={t('模型')}>
            <SettingsCard>
              {models.length === 0 ? (
                <div className={cn(SETTINGS_ROW_CLS, 'text-meta text-content-tertiary')}>
                  {t('还没有执行机上报 {runtime} 模型', { runtime: runtimeLabel })}
                </div>
              ) : (
                <div
                  data-testid="subscription-models"
                  className={cn(SETTINGS_ROW_CLS, 'flex-wrap justify-start gap-1.5 py-2.5')}
                >
                  {models.map((model) => (
                    <SubscriptionModelChip key={model.id} model={model} />
                  ))}
                </div>
              )}
            </SettingsCard>
          </SettingsSection>
        ) : (
          <section data-testid="subscription-models" className="flex min-w-0 flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <h3 className="m-0 text-ui font-semibold text-foreground">{t('模型')}</h3>
              <span
                data-testid="subscription-models-summary"
                className="text-meta text-content-tertiary"
              >
                {t('{n} 个', { n: picked.length })}
              </span>
              {actions.onPickUpstream !== undefined && (
                <span className="ml-auto flex items-center gap-2 max-sm:w-full max-sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="subscription-pick-upstream"
                    onClick={actions.onPickUpstream}
                  >
                    <Download aria-hidden />
                    {t('从上游选择')}
                  </Button>
                </span>
              )}
            </div>
            {picked.length === 0 ? (
              <p className="m-0 py-1 text-ui text-content-secondary">
                {t('还没勾选模型，订阅按执行机上报的名单兜底。')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {picked.map((model) => (
                  <PickedModelChip
                    key={model.id}
                    model={model}
                    busy={actions.modelsBusy ?? false}
                    {...(actions.onRemoveModel === undefined
                      ? {}
                      : { onRemove: () => actions.onRemoveModel?.(model.id) })}
                  />
                ))}
              </div>
            )}
          </section>
        )}
        {account.vendor !== 'devin' && account.vendor !== 'antigravity' && (
          <SettingsSection title={t('额度')}>
            <SettingsCard>
              <QuotaRows windows={account.windows} now={now} />
            </SettingsCard>
          </SettingsSection>
        )}
        <SettingsSection title={t('管理')}>
          <SettingsDangerZone
            label={t('移除订阅')}
            description={t('移除后，后续步骤不再使用这个订阅。')}
            actionLabel={t('移除')}
            onAction={actions.onRemove}
          />
        </SettingsSection>
      </div>
    </>
  );
}

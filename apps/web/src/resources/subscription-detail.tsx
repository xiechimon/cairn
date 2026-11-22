import type { ProviderFailure, ProviderTestResult } from '@cairn/shared';
import {
  MODEL_SOURCE_RUNTIME_LABELS,
  type ModelSource,
  type ModelSourceModel,
  type ModelSourceRuntime,
} from '@cairn/shared';
import { cn } from 'cn';
import { Download, Play } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import type { Verification, VerifyFailure, VerifyNotRun } from '../api/account-verification.js';
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
import { SettingsCard, SettingsDangerZone, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ACCENT_INK } from '../phase.js';
import {
  type CheckFact,
  CheckResultPopover,
  FAILURE_SENTENCE,
  FAILURE_SHORT,
  ModelChip,
  ModelTestReport,
  useModelTests,
} from './provider-editors.js';
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
    '这个订阅的登录已失效。先移除它，再运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出重新添加。',
  antigravity:
    '这个订阅的登录已失效。在执行机重新登录 Google 账号或更新 API key 后，移除并重新添加。',
};

const EXPIRED_RENEWAL: Record<AccountVendor, string> = {
  claude: '这个订阅已过期。先移除它，再在终端运行 `claude setup-token`，把新的 token 添加回来。',
  codex: '这个订阅已过期。先移除它，再重新添加新的 token。',
  grok: '这个订阅已过期。先移除它，再重新添加新的 token。',
  devin:
    '这个订阅已过期。先移除它，再运行 `cat ~/.local/share/devin/credentials.toml`，把完整输出重新添加。',
  antigravity: '这个订阅已过期。在执行机重新登录 Google 账号或更新 API key 后，移除并重新添加。',
};

const UNAVAILABLE_COPY: Record<AccountVendor, string> = {
  claude: '暂时无法连接 Claude 服务，请检查网络后重试。',
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
    missing_local_login: '执行机尚未登录 Antigravity，请先运行 `agy acp --login` 或改用 API key',
  };
}

const PASSED_COPY: Record<AccountVendor, string> = {
  claude: '这个订阅的登录有效。',
  codex: '这个订阅的登录有效。',
  grok: '这个订阅的登录有效。',
  devin: 'Devin 接受了这个凭据。',
  antigravity: 'Antigravity 接受了这个凭据。',
};

const VERIFYING_COPY: Record<AccountVendor, string> = {
  claude: '正在检查这个订阅的登录…',
  codex: '正在检查这个订阅的登录…',
  grok: '正在检查这个订阅的登录…',
  devin: '正在让 Devin 检查这个凭据…',
  antigravity: '正在让 Antigravity 检查这个凭据…',
};

const MODEL_FAILURE_SHORT: Record<ProviderFailure, string> = { ...FAILURE_SHORT, auth: '登录失效' };

const modelFailureSentence = (vendor: AccountVendor): Record<ProviderFailure, string> => ({
  ...FAILURE_SENTENCE,
  auth: AUTH_RENEWAL[vendor],
});

const FAILED_LABEL: Record<VerifyFailure, string> = {
  auth: '登录失效',
  timeout: '验证超时',
  unavailable: '无法验证',
  quota: '额度用尽',
  failed: '验证失败',
  missing_local_login: '执行机未登录',
};

const NOT_RUN_COPY: Record<VerifyNotRun, string> = {
  'signed-out':
    '这台设备的登录已失效，这次没有验证，订阅状态没有改变。请重新配对或在运行 Cairn 的电脑上验证。',
  network: '未连接到服务器，本次未验证，订阅状态未改变。服务器可能正在重启，请稍后重试。',
  'rate-limited': '验证太频繁，这次没有运行。',
  error: '服务器未能运行本次验证，订阅状态未改变。请重试。',
};

const STATUS_CLS = 'flex items-center gap-1.5 text-meta text-content-secondary';
const STATUS_DOT_CLS = 'size-1.5 flex-none rounded-full';

export interface SubscriptionStatusView {
  tone: ProviderTone;
  label: string | null;
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
  now: number,
  t: TFunc,
  clock: (ts: number, now: number) => string,
): SubscriptionStatusView {
  switch (account.state) {
    case 'ok':
      return { tone: 'ok', label: null, reason: null };
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
  if (
    models.length === 0 ||
    models.some((model) => model.liveness === 'dead' || model.updateRequired !== undefined)
  )
    return 'warn';
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
  const outdated = models.filter((model) => model.updateRequired !== undefined).length;
  return [
    t('订阅'),
    ...(account.plan === null ? [] : [account.plan]),
    t('{n} 个模型', { n: models.length }),
    ...(retired === 0 ? [] : [t('{n} 个已下架', { n: retired })]),
    ...(outdated === 0 ? [] : [t('{n} 个需要更新 Cairn', { n: outdated })]),
    ...(view.label === null ? [] : [view.label]),
    ...(account.lastUsedAt === null || view.label !== null
      ? []
      : [t('最近使用 {ago}', { ago: relativeTime(account.lastUsedAt, now, t) })]),
  ].join(' · ');
}

function quotaWindows(windows: readonly QuotaWindow[]): QuotaWindow[] {
  return WINDOW_ORDER.flatMap((name) => windows.filter((w) => w.name === name));
}

const QUOTA_MARKS: { name: string; label: string }[] = [
  { name: 'five_hour', label: '5h {left}%' },
  { name: 'seven_day', label: '周 {left}%' },
];

export function QuotaMarks({ windows }: { windows: readonly QuotaWindow[] }) {
  const { t } = useI18n();
  const marks = QUOTA_MARKS.flatMap(({ name, label }) => {
    const window = windows.find((w) => w.name === name);
    return window === undefined ? [] : [{ name, label, left: leftPercent(window) }];
  });
  if (marks.length === 0) return null;
  const summary = marks
    .map(({ name, left }) =>
      t('{window} 剩 {left}%', { window: t(WINDOW_LABELS[name] ?? name), left }),
    )
    .join(' · ');
  return (
    <span
      data-testid="subscription-quota-mini"
      role="img"
      aria-label={summary}
      title={summary}
      className="flex flex-none flex-col items-end gap-0.5 pt-0.5 text-caption text-content-tertiary tabular-nums"
    >
      {marks.map(({ name, label, left }) => (
        <span
          key={name}
          data-window={name}
          className={cn('whitespace-nowrap', isLowQuota(left) && ACCENT_INK)}
        >
          {t(label, { left })}
        </span>
      ))}
    </span>
  );
}

const HOUR = 3_600_000;

export function resetsIn(
  ts: number,
  now: number,
  t: TFunc,
  clock: (ts: number, now: number) => string,
): string {
  const left = ts - now;
  if (left <= 0) return t('即将重置');
  const minutes = Math.max(1, Math.round(left / 60_000));
  if (minutes < 90) return t('{n} 分钟后重置', { n: minutes });
  if (left < DAY) return t('{n} 小时后重置', { n: Math.round(left / HOUR) });
  return t('{time} 重置', { time: clock(ts, now) });
}

const QUOTA_ROW_CLS = 'settings-row grid min-h-11 items-center gap-x-3 py-2 text-meta tabular-nums';

function QuotaSection({ account, now }: { account: SubscriptionAccount; now: number }) {
  const { t } = useI18n();
  const clock = useClock();
  const ordered = quotaWindows(account.windows);
  if (ordered.length === 0) {
    return (
      <SettingsSection title={t('用量')} testId="subscription-usage">
        <SettingsCard>
          <div className={cn(QUOTA_ROW_CLS, 'grid-cols-[minmax(0,1fr)_auto]')}>
            <span className="text-content-secondary">{t('近 24 小时')}</span>
            <span className="text-foreground">
              {t('{n} 次运行', { n: account.stepsLast24h ?? 0 })}
            </span>
            {account.vendor !== 'claude' && (
              <span
                data-testid="subscription-usage-note"
                className="col-span-2 text-caption text-content-tertiary"
              >
                {t('{vendor} 不提供剩余用量', { vendor: VENDORS[account.vendor].short })}
              </span>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title={t('额度')} testId="subscription-quota">
      <SettingsCard>
        {ordered.map((window) => {
          const left = leftPercent(window);
          const label = t(WINDOW_LABELS[window.name] ?? window.name);
          return (
            <div
              key={window.name}
              className={cn(
                QUOTA_ROW_CLS,
                'grid-cols-[4.5rem_minmax(3rem,1fr)_4rem_minmax(0,8rem)] max-sm:grid-cols-[4rem_minmax(2rem,1fr)_3.5rem_minmax(0,6.5rem)]',
              )}
            >
              <span className="truncate text-content-secondary">{label}</span>
              <span
                role="progressbar"
                aria-label={t('{window} 剩余', { window: label })}
                aria-valuenow={left}
                aria-valuemin={0}
                aria-valuemax={100}
                className="block h-1 overflow-hidden rounded-full bg-secondary"
              >
                <i
                  className={cn(
                    'block h-full rounded-full',
                    isLowQuota(left) ? 'bg-(--card-button)' : 'bg-content-secondary',
                  )}
                  style={{ width: `${left}%` }}
                />
              </span>
              <span className={cn('text-right text-foreground', isLowQuota(left) && ACCENT_INK)}>
                {t('剩 {left}%', { left })}
              </span>
              <span
                data-testid="subscription-quota-reset"
                className="truncate text-right text-caption text-content-tertiary"
              >
                {window.resetsAt === null ? null : resetsIn(window.resetsAt, now, t, clock)}
              </span>
            </div>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}

function verifyDetail(
  verification: Exclude<Verification, { phase: 'verifying' }>,
  at: number,
  now: number,
  t: TFunc,
): CheckFact[] {
  const check = verification.phase === 'not-run' ? undefined : verification.check;
  const outcome =
    verification.phase === 'passed'
      ? t('通过')
      : verification.phase === 'not-run'
        ? t('没有运行')
        : t('未通过 · {reason}', { reason: t(FAILED_LABEL[verification.reason]) });
  return [
    { label: t('结果'), value: outcome },
    ...(check === undefined
      ? []
      : [{ label: t('用时'), value: t('{s} 秒', { s: (check.durationMs / 1000).toFixed(1) }) }]),
    { label: t('时间'), value: relativeTime(check?.at ?? at, now, t) },
    ...(check === undefined ? [] : [{ label: t('验证命令'), value: check.command, code: true }]),
  ];
}

function VerifyResultPopover({
  vendor,
  verification,
  anchor,
}: {
  vendor: AccountVendor;
  verification: Verification | undefined;
  anchor: Element | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(verification);
  const [at, setAt] = useState(0);
  if (seen !== verification) {
    setSeen(verification);
    setAt(Date.now());
    setOpen(verification !== undefined);
  }
  if (verification === undefined) return null;
  if (verification.phase === 'verifying') {
    return (
      <CheckResultPopover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        tone="checking"
        sentence={t(VERIFYING_COPY[vendor])}
        detail={null}
        testId="subscription-verify-feedback"
      />
    );
  }
  return (
    <CheckResultPopover
      anchor={anchor}
      open={open}
      onClose={() => setOpen(false)}
      tone={
        verification.phase === 'passed' ? 'ok' : verification.phase === 'failed' ? 'fail' : 'off'
      }
      phase={verification.phase}
      sentence={withCodeSpans(
        verification.phase === 'passed'
          ? t(PASSED_COPY[vendor])
          : verification.phase === 'not-run'
            ? t(NOT_RUN_COPY[verification.cause])
            : t(failureCopy(vendor)[verification.reason]),
      )}
      detail={verifyDetail(verification, at, Date.now(), t)}
      testId="subscription-verify-feedback"
      detailTestId="subscription-verify-detail"
    />
  );
}

export interface SubscriptionActions {
  onVerify?: () => void;
  onRename?: (label: string) => void;
  onRemove: () => void;
  onPickUpstream?: () => void;
  onRemoveModel?: (id: string) => void;
  onTestModel?: (id: string) => Promise<ProviderTestResult>;
  modelsBusy?: boolean;
}

const TEST_CONCURRENCY = 2;

function tierMeta(model: SubscriptionModel, t: TFunc) {
  const tier =
    model.costTier === undefined ? undefined : (COST_TIER_LABEL[model.costTier] ?? model.costTier);
  const context =
    model.contextTokens === undefined
      ? undefined
      : model.contextTokens >= 1_000_000
        ? `${Number((model.contextTokens / 1_000_000).toFixed(1))}M`
        : `${Math.round(model.contextTokens / 1000)}K`;
  const parts = [
    model.name === model.id ? null : model.name,
    tier === undefined ? null : t(tier),
    context ?? null,
  ].filter((v) => v !== null);
  if (parts.length === 0) return undefined;
  return (
    <span
      title={model.costSummary}
      className="flex-none text-caption text-content-tertiary tabular-nums"
    >
      {parts.join(' · ')}
    </span>
  );
}

export function SubscriptionDetail({
  account,
  models,
  now,
  view,
  verification,
  actions,
  relogin,
}: {
  account: SubscriptionAccount;
  models: readonly SubscriptionModel[];
  now: number;
  view: SubscriptionStatusView;
  verification: Verification | undefined;
  actions: SubscriptionActions;
  relogin?: ReactNode;
}) {
  const { t } = useI18n();
  const test = actions.onTestModel;
  const tests = useModelTests(test, TEST_CONCURRENCY);
  const { checks } = tests;
  const testAllRef = useRef<HTMLButtonElement>(null);
  const verifyRef = useRef<HTMLButtonElement>(null);
  const [checkedAccount, setCheckedAccount] = useState(account.id);
  if (checkedAccount !== account.id) {
    setCheckedAccount(account.id);
    tests.reset();
  }
  const ids = models.map((model) => model.id);
  const running = ids.filter((id) => checks[id]?.phase === 'running').length;
  const summary = t('{n} 个', { n: ids.length });
  const runtime = SUBSCRIPTION_RUNTIME[account.vendor];
  const runtimeLabel =
    runtime === undefined ? VENDORS[account.vendor].label : MODEL_SOURCE_RUNTIME_LABELS[runtime];
  const verifying = verification?.phase === 'verifying';
  return (
    <div
      data-testid="subscription-detail"
      data-account-id={account.id}
      data-tone={view.tone}
      className="@container flex flex-col gap-6"
    >
      <ProviderEditorHead
        Mark={VENDORS[account.vendor].Mark}
        name={account.label}
        kind={[
          t('订阅'),
          ...(account.plan === null ? [] : [account.plan]),
          account.lastUsedAt === null
            ? t('尚未使用')
            : t('最近使用 {ago}', { ago: relativeTime(account.lastUsedAt, now, t) }),
        ].join(' · ')}
        {...(actions.onRename === undefined ? {} : { onRename: actions.onRename })}
        aside={
          actions.onVerify !== undefined && (
            <Button
              ref={verifyRef}
              variant="outline"
              size="sm"
              data-testid="subscription-verify"
              disabled={verifying}
              onClick={actions.onVerify}
            >
              {t('验证')}
            </Button>
          )
        }
      />
      {(view.label !== null || view.reason !== null) && (
        <div className="-mt-3 flex flex-col gap-1">
          {view.label !== null && (
            <span data-testid="subscription-status" className={STATUS_CLS}>
              <span aria-hidden className={cn(STATUS_DOT_CLS, TONE_DOT[view.tone])} />
              {view.label}
            </span>
          )}
          {view.reason !== null && (
            <p data-testid="subscription-reason" className="m-0 text-meta text-content-tertiary">
              {withCodeSpans(view.reason)}
            </p>
          )}
        </div>
      )}
      {relogin}
      <QuotaSection account={account} now={now} />
      <VerifyResultPopover
        vendor={account.vendor}
        verification={verification}
        anchor={verifyRef.current}
      />
      <section data-testid="subscription-models" className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <h3 className="m-0 text-ui font-semibold text-foreground">{t('模型')}</h3>
          <span
            data-testid="subscription-models-summary"
            className="text-meta text-content-tertiary"
          >
            {summary}
          </span>
          <span className="ml-auto flex items-center gap-2 max-sm:w-full max-sm:justify-end">
            {actions.onPickUpstream !== undefined && (
              <Button
                variant="outline"
                size="sm"
                data-testid="subscription-pick-upstream"
                onClick={actions.onPickUpstream}
              >
                <Download aria-hidden />
                {t('从上游选择')}
              </Button>
            )}
            {test !== undefined && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      ref={testAllRef}
                      data-testid="subscription-test-all"
                      className="min-w-24"
                      disabled={running > 0 || ids.length === 0}
                      onClick={() => void tests.run(ids, testAllRef.current)}
                    />
                  }
                >
                  <Play aria-hidden />
                  {t('全部测试')}
                </TooltipTrigger>
                <TooltipContent data-testid="subscription-test-cost" sideOffset={8}>
                  {t('每个模型测试会发一次很短的请求，算在订阅额度里。')}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        </div>
        {models.length === 0 ? (
          <p className="m-0 py-1 text-ui text-content-secondary">
            {actions.onPickUpstream === undefined
              ? t('暂无执行机上报 {runtime} 模型', { runtime: runtimeLabel })
              : t('尚未勾选模型。从上游获取模型清单后勾选。')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {models.map((model) => (
              <ModelChip
                key={model.id}
                id={model.id}
                testId="subscription-model"
                dead={model.liveness === 'dead'}
                needsUpdate={'updateRequired' in model && model.updateRequired !== undefined}
                check={checks[model.id]}
                busy={actions.modelsBusy ?? false}
                meta={tierMeta(model, t)}
                {...(test === undefined
                  ? {}
                  : { onTest: (anchor: Element) => void tests.run([model.id], anchor) })}
                {...(actions.onRemoveModel === undefined
                  ? {}
                  : {
                      onRemove: () => {
                        actions.onRemoveModel?.(model.id);
                        tests.drop(model.id);
                      },
                    })}
              />
            ))}
          </div>
        )}
        <ModelTestReport
          report={tests.report}
          checks={checks}
          failureSentence={modelFailureSentence(account.vendor)}
          failureShort={MODEL_FAILURE_SHORT}
          onClose={tests.close}
        />
      </section>
      <SettingsSection title={t('管理')}>
        <SettingsDangerZone
          label={t('移除订阅')}
          actionLabel={t('移除')}
          onAction={actions.onRemove}
        />
      </SettingsSection>
    </div>
  );
}

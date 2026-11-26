import {
  compareManagedVersions,
  isNewerManagedVersion,
  type ManagedUpdateRuntime,
  MODEL_SOURCE_RUNTIME_LABELS,
  type ModelSource,
  type ModelSourceModel,
  type ModelSourceRuntime,
  PROVIDER_OAUTH_PRESET_IDS,
  type ProviderFailure,
  type ProviderRecord,
  type ProviderTestResult,
  type RoutingConnection,
  type SubscriptionCheck,
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
  PROVIDER_STATUS,
  ProviderEditorHead,
  type ProviderItem,
  type ProviderTone,
  SignInAgainButton,
  TONE_DOT,
} from '../components/providers/provider-panel.js';
import { isLowQuota } from '../components/settings/quota-row.js';
import { SettingsCard, SettingsDangerZone, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { selectRowChecks, type TeamProviderChecks } from './provider-check-state.js';
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

const WINDOW_LABELS = new Map([
  ['five_hour', '5 小时'],
  ['seven_day', '每周'],
  ['billing_period', '计费周期'],
  ['gemini-5h', 'Gemini · 5 小时'],
  ['gemini-weekly', 'Gemini · 每周'],
  ['3p-5h', 'Claude / GPT · 5 小时'],
  ['3p-weekly', 'Claude / GPT · 每周'],
]);

const AUTH_RENEWAL: Record<AccountVendor, string> = {
  claude:
    '这个订阅的登录已失效。先移除它，再在终端运行 `claude setup-token`，把新的 token 添加回来。',
  codex: '这个订阅的登录已失效。点击「重新登录」更新凭据。',
  grok: '这个订阅的登录已失效。点击「重新登录」更新凭据。',
  devin: '这个订阅的登录已失效。点击「重新登录」更新凭据。',
  antigravity: '这个订阅的登录已失效。点击「重新登录」更新凭据。',
};

const EXPIRED_RENEWAL_COPY = '这个订阅已过期。点击「重新登录」更新凭据。';

const EXPIRED_RENEWAL: Record<AccountVendor, string> = {
  claude: EXPIRED_RENEWAL_COPY,
  codex: EXPIRED_RENEWAL_COPY,
  grok: EXPIRED_RENEWAL_COPY,
  devin: EXPIRED_RENEWAL_COPY,
  antigravity: EXPIRED_RENEWAL_COPY,
};

const UNAVAILABLE_COPY: Record<AccountVendor, string> = {
  claude: '暂时无法连接 Claude 服务，请检查网络后重试。',
  codex: '服务器上找不到 codex 命令',
  grok: '服务器上找不到可执行的 agent',
  devin: '服务器上找不到 devin 命令',
  antigravity: AUTH_RENEWAL.antigravity,
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
  statusGlyph?: ProviderItem['statusGlyph'];
}

export function teamProviderStatusView(
  record: ProviderRecord,
  connections: readonly RoutingConnection[],
  checks: TeamProviderChecks | undefined,
  t: TFunc,
): SubscriptionStatusView {
  const matching = selectRowChecks(checks, record.configurationFingerprint);
  const results = record.models.flatMap((model) => matching?.[model.id] ?? []);
  const result = results.find((result) => result.status === 'failed');
  const oauth = (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(record.providerId);
  if (result?.status === 'failed') {
    return {
      tone: 'fail',
      label:
        result.failure === 'auth' && oauth
          ? t('未登录')
          : result.failure === null
            ? t('无法连接服务商')
            : t(FAILURE_SHORT[result.failure]),
      reason: null,
    };
  }
  if (results.some((result) => result.status === 'ok')) {
    return { tone: 'ok', label: null, reason: null };
  }
  const owned = connections.filter((connection) => connection.id === record.id);
  if (
    (record.authHeader || oauth) &&
    owned.length > 0 &&
    owned.every((connection) => !connection.available)
  ) {
    return { tone: 'warn', label: oauth ? t('未登录') : t('填写 API key'), reason: null };
  }
  return { tone: 'off', label: t('未检查'), reason: null };
}

const DAY = 86_400_000;

function recoversIn(ts: number, now: number, t: TFunc): string {
  const minutes = Math.max(1, Math.round((ts - now) / 60_000));
  if (minutes < 60) return t('{n} 分钟后恢复', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} 小时后恢复', { n: hours });
  return t('{n} 天后恢复', { n: Math.round((hours * 3_600_000) / DAY) });
}

function hostRunnerStatusLabel(account: SubscriptionAccount, t: TFunc): string | null {
  const logins = account.runnerLogins ?? [];
  const signedIn = logins.filter((entry) => entry.status === 'ok').map((entry) => entry.name);
  const notSignedIn = logins.filter((entry) => entry.status !== 'ok').map((entry) => entry.name);
  const boundName = account.runnerName ?? null;

  if (account.runnerOffline === true) {
    const offline =
      boundName !== null ? t('执行机 {machine} 离线', { machine: boundName }) : t('执行机离线');
    return signedIn.length > 0
      ? `${offline} · ${t('已在 {machine} 登录', { machine: signedIn.join(', ') })}`
      : offline;
  }
  if (account.runnerLogin === 'missing_local_login') {
    if (boundName !== null && signedIn.length > 0) {
      return t('{signedOut} 未登录，已在 {signedIn} 登录', {
        signedOut: boundName,
        signedIn: signedIn.join(', '),
      });
    }
    if (boundName !== null) return t('{machine} 未登录', { machine: boundName });
    return t(FAILED_LABEL.missing_local_login);
  }
  if (account.runnerLogin === 'unavailable') {
    if (boundName !== null) {
      const unavailable = t('{machine} 无法验证', { machine: boundName });
      return signedIn.length > 0
        ? `${unavailable} · ${t('已在 {machine} 登录', { machine: signedIn.join(', ') })}`
        : unavailable;
    }
    if (signedIn.length > 0 && notSignedIn.length > 0) {
      return t('已在 {signedIn} 登录，{signedOut} 未登录', {
        signedIn: signedIn.join(', '),
        signedOut: notSignedIn.join(', '),
      });
    }
    if (notSignedIn.length > 0) return t('{machine} 未登录', { machine: notSignedIn.join(', ') });
    if (signedIn.length > 0) return t('已在 {machine} 登录', { machine: signedIn.join(', ') });
    return t(FAILED_LABEL.unavailable);
  }
  if (account.runnerLogin === 'ok') {
    if (signedIn.length > 0 && notSignedIn.length > 0) {
      return t('已在 {signedIn} 登录，{signedOut} 未登录', {
        signedIn: signedIn.join(', '),
        signedOut: notSignedIn.join(', '),
      });
    }
    if (boundName !== null) return t('已在 {machine} 登录', { machine: boundName });
    if (signedIn.length > 0) return t('已在 {machine} 登录', { machine: signedIn.join(', ') });
    return null;
  }
  return null;
}

export function subscriptionStatusView(
  account: SubscriptionAccount,
  now: number,
  t: TFunc,
  clock: (ts: number, now: number) => string,
): SubscriptionStatusView {
  switch (account.state) {
    case 'ok':
      if (account.runnerOffline === true) {
        return { tone: 'warn', label: hostRunnerStatusLabel(account, t), reason: null };
      }
      if (account.runnerLogin === 'unavailable' || account.runnerLogin === 'missing_local_login') {
        const reason =
          account.vendor === 'antigravity' &&
          account.runnerLogin === 'missing_local_login' &&
          account.runnerName != null
            ? t('这个订阅绑定在 {machine}。请在 {machine} 上登录 Antigravity，或改用 API key。', {
                machine: account.runnerName,
              })
            : account.vendor === 'antigravity' &&
                account.runnerLogin === 'unavailable' &&
                account.runnerName != null
              ? t(
                  '{machine} 尚未安装 Antigravity，或暂不可用。请确认执行机在线后重试，或改用 API key。',
                  {
                    machine: account.runnerName,
                  },
                )
              : account.vendor === 'antigravity' &&
                  account.runnerLogin === 'unavailable' &&
                  account.runnerName == null &&
                  (account.runnerLogins?.length ?? 0) > 1
                ? t('这个订阅尚未绑定执行机。请先在目标执行机登录 Antigravity，或改用 API key。')
                : t(AUTH_RENEWAL[account.vendor]);
        return {
          tone: 'warn',
          label: hostRunnerStatusLabel(account, t),
          reason,
        };
      }
      if (account.runnerLogin === 'ok') {
        return { tone: 'ok', label: hostRunnerStatusLabel(account, t), reason: null };
      }
      return account.hasToken === false
        ? { tone: 'warn', label: t('未登录'), reason: null }
        : { tone: 'ok', label: null, reason: null };
    case 'cooling':
      return {
        tone: 'off',
        statusGlyph: 'cooling',
        label:
          account.cooldownUntil === null
            ? t('冷却中')
            : t('冷却至 {time}', { time: clock(account.cooldownUntil, now) }),
        reason: null,
      };
    case 'exhausted':
      return {
        tone: 'off',
        statusGlyph: 'exhausted',
        label: t('额度用尽'),
        reason:
          account.cooldownUntil !== null && account.cooldownUntil > now
            ? recoversIn(account.cooldownUntil, now, t)
            : null,
      };
    case 'expired':
      return {
        tone: 'warn',
        statusGlyph: 'expired',
        label: t('已过期'),
        reason: t(EXPIRED_RENEWAL[account.vendor]),
      };
  }
}

const SUBSCRIPTION_RUNTIME: Partial<Record<AccountVendor, ModelSourceRuntime>> = {
  claude: 'claude-code',
  devin: 'devin',
  antigravity: 'antigravity',
};

export interface RuntimeUpdateSummary {
  runtime: ManagedUpdateRuntime;
  installedVersion: string | null;
  availableVersion: string | null;
  phase: 'idle' | 'updating' | 'failed';
}

export function runtimeUpdateSummary(
  sources: readonly ModelSource[],
  runtime: ManagedUpdateRuntime,
): RuntimeUpdateSummary | null {
  const matching = sources.filter(
    (source) =>
      source.runtime === runtime && (source.installed || source.runtimeUpdate !== undefined),
  );
  if (matching.length === 0) return null;
  let installedVersion: string | null = null;
  let availableVersion: string | null = null;
  let phase: 'idle' | 'updating' | 'failed' = 'idle';
  for (const source of matching) {
    const installed =
      source.version ?? source.bin?.version ?? source.runtimeUpdate?.installedVersion ?? null;
    if (
      installed !== null &&
      (installedVersion === null || compareManagedVersions(installed, installedVersion) > 0)
    ) {
      installedVersion = installed;
    }
    const available = source.runtimeUpdate?.availableVersion ?? null;
    if (
      available !== null &&
      (availableVersion === null || compareManagedVersions(available, availableVersion) > 0)
    ) {
      availableVersion = available;
    }
    if (source.runtimeUpdate?.phase === 'updating') phase = 'updating';
    else if (source.runtimeUpdate?.phase === 'failed' && phase !== 'updating') phase = 'failed';
  }
  if (
    availableVersion !== null &&
    installedVersion !== null &&
    !isNewerManagedVersion(availableVersion, installedVersion)
  ) {
    availableVersion = null;
  }
  return { runtime, installedVersion, availableVersion, phase };
}

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

export function providerRowStatus(
  view: SubscriptionStatusView,
  models: readonly ModelSourceModel[],
  t: TFunc,
): Pick<ProviderItem, 'tone' | 'statusLabel' | 'statusGlyph'> {
  const retired = models.filter((model) => model.liveness === 'dead').length;
  const outdated = models.filter((model) => model.updateRequired !== undefined).length;
  const modelLabels = [
    ...(retired === 0 ? [] : [`${t('已下架')} · ${t('{n} 个模型', { n: retired })}`]),
    ...(outdated === 0 ? [] : [t('{n} 个模型需要新版 Cairn', { n: outdated })]),
  ];
  const statusGlyph =
    view.statusGlyph ??
    (view.tone === 'fail'
      ? 'fail'
      : models.length === 0 || modelLabels.length > 0
        ? 'warn'
        : view.tone);
  const emptyWarning =
    models.length === 0 && statusGlyph === 'warn' ? t(PROVIDER_STATUS.warn.label) : null;
  const labels = new Set([view.label, emptyWarning, ...modelLabels].filter(Boolean));
  return {
    tone: PROVIDER_STATUS[statusGlyph].tone,
    statusLabel: [...labels].join(' · ') || t(PROVIDER_STATUS[statusGlyph].label),
    statusGlyph,
  };
}

export function subscriptionSummary(modelCount: number, t: TFunc): string {
  return [t('订阅'), t('{n} 个模型', { n: modelCount })].join(' · ');
}

function quotaWindows(windows: readonly QuotaWindow[]): QuotaWindow[] {
  return [
    ...Array.from(WINDOW_LABELS.keys()).flatMap((name) => windows.filter((w) => w.name === name)),
    ...windows.filter((w) => !WINDOW_LABELS.has(w.name)),
  ];
}

function quotaReading(window: QuotaWindow, t: TFunc) {
  const knownLabel = WINDOW_LABELS.get(window.name);
  const name = window.name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  const label =
    knownLabel === undefined ? name.charAt(0).toUpperCase() + name.slice(1) : t(knownLabel);
  const left = Math.min(100, Math.max(0, Math.round((1 - window.utilization) * 100)));
  const remaining = t('{window} 剩 {left}%', { window: label, left });
  return {
    label,
    left,
    remaining,
    value: t('剩 {left}%', { left }),
  };
}

export function QuotaMark({ windows }: { windows: readonly QuotaWindow[] }) {
  const { t } = useI18n();
  let tightest: QuotaWindow | undefined;
  for (const window of quotaWindows(windows)) {
    if (tightest === undefined || window.utilization > tightest.utilization) tightest = window;
  }
  if (tightest === undefined) return null;
  const { left, remaining, value } = quotaReading(tightest, t);
  return (
    <span
      data-testid="subscription-quota-mini"
      data-window={tightest.name}
      role="img"
      aria-label={remaining}
      title={remaining}
      className={cn(
        'flex-none whitespace-nowrap pt-1 text-caption text-content-secondary tabular-nums',
        isLowQuota(left) && 'text-tint-wait-ink',
      )}
    >
      {value}
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

function QuotaSection({ account, now }: { account: SubscriptionAccount; now: number }) {
  const { t } = useI18n();
  const clock = useClock();
  const ordered = quotaWindows(account.windows);
  return (
    <>
      <SettingsSection title={t('用量')} testId="subscription-usage">
        <SettingsCard>
          <div className="settings-row grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-meta tabular-nums">
            <span className="text-content-secondary">{t('近 24 小时')}</span>
            <span className="text-foreground">
              {t('{n} 次运行', { n: account.stepsLast24h ?? 0 })}
            </span>
            {ordered.length === 0 &&
              account.vendor !== 'claude' &&
              account.vendor !== 'antigravity' && (
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
      {ordered.length > 0 && (
        <SettingsSection title={t('额度')} testId="subscription-quota">
          <SettingsCard className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content_max-content] gap-x-2">
            {ordered.map((window) => {
              const { label, left, remaining, value } = quotaReading(window, t);
              const reset =
                window.resetsAt === null ? null : resetsIn(window.resetsAt, now, t, clock);
              const low = isLowQuota(left);
              return (
                <div
                  key={window.name}
                  data-testid="subscription-quota-window"
                  className="settings-row col-span-full grid min-h-11 min-w-0 grid-cols-subgrid items-center gap-x-2 py-2 text-meta tabular-nums"
                >
                  <span
                    data-testid="subscription-quota-name"
                    title={label}
                    className="min-w-0 truncate text-content-secondary"
                  >
                    {label}
                  </span>
                  <span
                    role="progressbar"
                    aria-label={t('{window} 剩余', { window: label })}
                    aria-valuenow={left}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1 min-w-0 overflow-hidden rounded-full bg-secondary"
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        low ? 'bg-(--card-button)' : 'bg-content-secondary',
                      )}
                      style={{ width: `${left}%` }}
                    />
                  </span>
                  <span
                    data-testid="subscription-quota-remaining"
                    role="img"
                    aria-label={remaining}
                    className={cn(
                      'flex-none whitespace-nowrap text-foreground',
                      low && 'text-tint-wait-ink',
                    )}
                  >
                    {value}
                  </span>
                  {reset !== null && (
                    <span
                      data-testid="subscription-quota-reset"
                      title={reset}
                      className="flex-none whitespace-nowrap text-caption text-content-tertiary"
                    >
                      {`· ${reset}`}
                    </span>
                  )}
                </div>
              );
            })}
          </SettingsCard>
        </SettingsSection>
      )}
    </>
  );
}

function isApiVerificationCheck(check: SubscriptionCheck): boolean {
  if (check.via !== undefined) return check.via === 'api';
  return (
    check.command === 'Antigravity account API' ||
    /^(GET|POST|PUT|PATCH|DELETE)\s+https?:\/\//.test(check.command)
  );
}

const ACCOUNT_API_CHECK_LABEL: Partial<Record<AccountVendor, string>> = {
  antigravity: 'Antigravity 账号接口',
  claude: 'Claude 账号接口',
};

export function verifyDetailFacts(
  vendor: AccountVendor,
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
  const showDuration =
    check !== undefined &&
    !(
      verification.phase === 'failed' &&
      verification.reason === 'unavailable' &&
      check.durationMs < 50
    );
  const checkFact: CheckFact[] =
    check === undefined
      ? []
      : isApiVerificationCheck(check)
        ? [
            {
              label: t('验证方式'),
              value: t(ACCOUNT_API_CHECK_LABEL[vendor] ?? '账号接口'),
            },
          ]
        : [{ label: t('验证命令'), value: check.command, code: true }];
  return [
    { label: t('结果'), value: outcome },
    ...(showDuration
      ? [{ label: t('用时'), value: t('{s} 秒', { s: (check.durationMs / 1000).toFixed(1) }) }]
      : []),
    { label: t('时间'), value: relativeTime(check?.at ?? at, now, t) },
    ...checkFact,
  ];
}

function VerifyResultPopover({
  vendor,
  verification,
  anchor,
  runnerId,
  runnerLogin,
  runnerOffline,
  runnerName,
  multiRunnerUnbound,
  expired,
}: {
  vendor: AccountVendor;
  expired: boolean;
  verification: Verification | undefined;
  anchor: Element | null;
  runnerId: string | null | undefined;
  runnerLogin: SubscriptionAccount['runnerLogin'];
  runnerOffline: boolean | undefined;
  runnerName: string | null | undefined;
  multiRunnerUnbound: boolean;
}) {
  const { t } = useI18n();
  const runnerStateKey = JSON.stringify([
    runnerId ?? null,
    runnerLogin ?? null,
    runnerOffline === true,
  ]);
  const [open, setOpen] = useState(() => verification?.phase === 'verifying');
  const [seen, setSeen] = useState(verification);
  const [seenRunnerState, setSeenRunnerState] = useState(runnerStateKey);
  const [at, setAt] = useState(0);
  if (seen !== verification) {
    setSeen(verification);
    setSeenRunnerState(runnerStateKey);
    setAt(Date.now());
    setOpen(verification !== undefined);
  } else if (seenRunnerState !== runnerStateKey) {
    setSeenRunnerState(runnerStateKey);
    if (verification !== undefined && verification.phase !== 'verifying') {
      setOpen(false);
    }
  }
  if (verification === undefined) return null;
  if (verification.phase === 'verifying') {
    const checkingRunner = verification.runnerName ?? runnerName ?? null;
    return (
      <CheckResultPopover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        tone="checking"
        sentence={
          vendor === 'antigravity' && checkingRunner !== null
            ? t('正在让 {machine} 上的 Antigravity 检查这个凭据…', { machine: checkingRunner })
            : t(VERIFYING_COPY[vendor])
        }
        detail={null}
        testId="subscription-verify-feedback"
      />
    );
  }
  const checkedRunner =
    verification.phase === 'not-run' ? null : (verification.runnerName ?? runnerName ?? null);
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
          ? vendor === 'antigravity' && checkedRunner !== null
            ? t('{machine} 上的 Antigravity 接受了这个凭据。', { machine: checkedRunner })
            : t(PASSED_COPY[vendor])
          : verification.phase === 'not-run'
            ? t(NOT_RUN_COPY[verification.cause])
            : runnerOffline === true && verification.reason === 'unavailable'
              ? checkedRunner !== null
                ? t('执行机 {machine} 离线', { machine: checkedRunner })
                : t('执行机离线')
              : verification.reason === 'unavailable' &&
                  vendor === 'antigravity' &&
                  checkedRunner !== null
                ? t(
                    '无法在 {machine} 上运行 Antigravity 检查，请确认执行机已安装 Antigravity 且在线后重试。',
                    { machine: checkedRunner },
                  )
                : verification.reason === 'unavailable' &&
                    vendor === 'antigravity' &&
                    checkedRunner === null &&
                    multiRunnerUnbound
                  ? t('这个订阅尚未绑定执行机。请先在目标执行机登录 Antigravity，或改用 API key。')
                  : verification.reason === 'timeout' &&
                      vendor === 'antigravity' &&
                      checkedRunner !== null
                    ? t('{machine} 上的 Antigravity 验证超时，请重试', { machine: checkedRunner })
                    : verification.reason === 'auth' && expired
                      ? t(EXPIRED_RENEWAL[vendor])
                      : verification.reason === 'missing_local_login' && checkedRunner !== null
                        ? t(
                            '{machine} 尚未登录 Antigravity，请先运行 `agy acp --login` 或改用 API key',
                            {
                              machine: checkedRunner,
                            },
                          )
                        : t(failureCopy(vendor)[verification.reason]),
      )}
      detail={verifyDetailFacts(vendor, verification, at, Date.now(), t)}
      testId="subscription-verify-feedback"
      detailTestId="subscription-verify-detail"
    />
  );
}

export interface SubscriptionActions {
  onSignInAgain?: () => void;
  signingInAgain?: boolean;
  onVerify?: () => void;
  onUpdateRuntime?: () => void;
  updatingRuntime?: boolean;
  onRename?: (label: string) => void;
  onRemove: () => void;
  onPickUpstream?: (opener: HTMLButtonElement) => void;
  onRemoveModel?: (id: string) => void;
  onTestModel?: (id: string) => Promise<ProviderTestResult>;
  modelsBusy?: boolean;
}

export function needsSubscriptionSignIn(
  account: SubscriptionAccount,
  verification: Verification | undefined,
): boolean {
  if (account.state === 'expired') return true;
  if (
    verification?.phase === 'failed' &&
    (verification.reason === 'auth' || verification.reason === 'missing_local_login')
  ) {
    return true;
  }
  if (
    account.vendor === 'antigravity' &&
    account.hasToken === false &&
    account.runnerOffline !== true &&
    (account.runnerLogin === 'missing_local_login' ||
      (account.runnerLogin === 'unavailable' && account.runnerId == null))
  ) {
    return true;
  }
  return false;
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
  runtimeUpdate,
  actions,
  relogin,
}: {
  account: SubscriptionAccount;
  models: readonly (SubscriptionModel & Pick<ModelSourceModel, 'updateRequired'>)[];
  now: number;
  view: SubscriptionStatusView;
  verification: Verification | undefined;
  runtimeUpdate?: RuntimeUpdateSummary | null;
  actions: SubscriptionActions;
  relogin?: ReactNode;
}) {
  const { t } = useI18n();
  const test = actions.onTestModel;
  const tests = useModelTests(test, TEST_CONCURRENCY);
  const { checks } = tests;
  const testAllRef = useRef<HTMLButtonElement>(null);
  const [verifyEl, setVerifyEl] = useState<HTMLButtonElement | null>(null);
  const [checkedAccount, setCheckedAccount] = useState(account.id);
  if (checkedAccount !== account.id) {
    setCheckedAccount(account.id);
    tests.reset();
  }
  const ids = models.map((model) => model.id);
  const updateModels = models.filter((model) => model.updateRequired !== undefined);
  const running = ids.filter((id) => checks[id]?.phase === 'running').length;
  const retired = models.filter((model) => model.liveness === 'dead').length;
  const summary = [
    t('{n} 个', { n: ids.length }),
    ...(retired === 0 ? [] : [`${t('已下架')} · ${t('{n} 个模型', { n: retired })}`]),
  ].join(' · ');
  const runtime = SUBSCRIPTION_RUNTIME[account.vendor];
  const runtimeLabel =
    runtime === undefined ? VENDORS[account.vendor].label : MODEL_SOURCE_RUNTIME_LABELS[runtime];
  const verifying = verification?.phase === 'verifying';
  const runtimeUpdating = actions.updatingRuntime === true || runtimeUpdate?.phase === 'updating';
  const showRuntimeUpdate =
    actions.onUpdateRuntime !== undefined &&
    runtimeUpdate != null &&
    (runtimeUpdate.availableVersion !== null ||
      runtimeUpdating ||
      runtimeUpdate.phase === 'failed');
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
        version={runtimeUpdate?.installedVersion ?? null}
        kind={[
          t('订阅'),
          ...(account.plan === null ? [] : [account.plan]),
          account.lastUsedAt === null
            ? t('尚未使用')
            : t('最近使用 {ago}', { ago: relativeTime(account.lastUsedAt, now, t) }),
        ].join(' · ')}
        {...(actions.onRename === undefined ? {} : { onRename: actions.onRename })}
        aside={
          (actions.onSignInAgain !== undefined ||
            showRuntimeUpdate ||
            actions.onVerify !== undefined) && (
            <span className="flex items-center gap-2">
              {actions.onSignInAgain !== undefined && (
                <SignInAgainButton
                  onClick={actions.onSignInAgain}
                  pending={actions.signingInAgain === true}
                />
              )}
              {showRuntimeUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="runtime-update"
                  disabled={runtimeUpdating}
                  aria-label={
                    runtimeUpdate.availableVersion !== null
                      ? t('更新到 {version}', { version: `v${runtimeUpdate.availableVersion}` })
                      : t('更新')
                  }
                  onClick={actions.onUpdateRuntime}
                >
                  {runtimeUpdating ? t('更新中…') : t('更新')}
                </Button>
              )}
              {actions.onVerify !== undefined && (
                <Button
                  ref={setVerifyEl}
                  variant="outline"
                  size="sm"
                  data-testid="subscription-verify"
                  disabled={verifying}
                  onClick={actions.onVerify}
                >
                  {t('验证')}
                </Button>
              )}
            </span>
          )
        }
      />
      {showRuntimeUpdate && (
        <p
          data-testid="runtime-update-status"
          className={cn(
            '-mt-3 m-0 text-meta tabular-nums',
            runtimeUpdate.phase === 'failed' ? 'text-destructive' : 'text-content-tertiary',
          )}
        >
          {runtimeUpdating
            ? t('正在后台下载并验证新版本，运行中的会话不受影响。')
            : runtimeUpdate.phase === 'failed'
              ? t('更新未能通过验证，仍在使用当前版本。')
              : t('有新版本 v{version} 可用', { version: runtimeUpdate.availableVersion ?? '' })}
        </p>
      )}
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
        expired={account.state === 'expired'}
        runnerId={account.runnerId}
        runnerLogin={account.runnerLogin}
        runnerOffline={account.runnerOffline}
        runnerName={account.runnerName}
        multiRunnerUnbound={account.runnerId == null && (account.runnerLogins?.length ?? 0) > 1}
        verification={verification}
        anchor={verifyEl}
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
                onClick={(event) => actions.onPickUpstream?.(event.currentTarget)}
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
        {updateModels.length > 0 && (
          <p className="m-0 wrap-anywhere text-meta text-content-tertiary tabular-nums">
            {t('{n} 个模型需要新版 Cairn', { n: updateModels.length })}
            {' · '}
            {updateModels.map((model) => model.id).join(', ')}
          </p>
        )}
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

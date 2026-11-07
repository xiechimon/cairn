import { cn } from 'cn';
import type { AccountStatus, VerifyFailure } from '../api/account-verification.js';
import type {
  AccountStep,
  QuotaWindow,
  StickyThread,
  SubscriptionAccount,
} from '../api/claude-accounts.js';
import { relativeTime } from '../board/rel-time.js';
import { AccountStepRow, StickyThreadRow, useClock } from '../components/accounts/account-parts.js';
import { ClaudeMark } from '../components/brand-marks.js';
import { ListCard } from '../components/list-card.js';
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
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ACCENT_INK } from '../phase.js';
import { CommitInput } from './provider-editors.js';

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5 小时',
  seven_day: '每周',
  billing_period: '计费周期',
};

const WINDOW_ORDER = ['five_hour', 'seven_day', 'billing_period'];

const FAILURE_COPY: Record<VerifyFailure, string> = {
  auth: '登录已失效，请重新生成令牌后再添加',
  timeout: '验证超时，请重试',
  unavailable: '服务器上找不到 claude 命令',
  failed: '验证没有通过，请重试',
  network: '连接中断，服务器可能正在重启，请重试',
  'rate-limited': '验证太频繁，请 10 秒后重试',
};

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
  if (status.kind === 'verify-failed') {
    return { tone: 'fail', label: t('验证失败'), reason: t(FAILURE_COPY[status.reason]) };
  }
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
      return { tone: 'warn', label: t('已过期'), reason: t('令牌已过期，请重新添加') };
  }
}

const leftPercent = (window: QuotaWindow) =>
  Math.max(0, Math.round((1 - window.utilization) * 100));

export function subscriptionSummary(
  account: SubscriptionAccount,
  view: SubscriptionStatusView,
  now: number,
  t: TFunc,
): string {
  return [
    t('订阅'),
    ...(account.plan === null ? [] : [account.plan]),
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
}

export function SubscriptionDetail({
  account,
  now,
  view,
  verifying,
  steps,
  sticky,
  actions,
}: {
  account: SubscriptionAccount;
  now: number;
  view: SubscriptionStatusView;
  verifying: boolean;
  steps: AccountStep[] | undefined;
  sticky: StickyThread[];
  actions: SubscriptionActions;
}) {
  const { t } = useI18n();
  const neverUsed = account.lastUsedAt === null && account.stepsLast24h === null;
  return (
    <>
      <ProviderEditorHead
        Mark={ClaudeMark}
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
            <span
              data-testid="subscription-status"
              className="flex items-center gap-1.5 text-meta text-content-secondary"
            >
              <span
                aria-hidden
                className={cn('size-1.5 flex-none rounded-full', TONE_DOT[view.tone])}
              />
              {view.label}
            </span>
            {actions.onVerify !== undefined && (
              <Button
                variant="outline"
                size="sm"
                data-testid="subscription-verify"
                disabled={verifying}
                onClick={actions.onVerify}
              >
                {view.tone === 'fail' ? t('重试') : t('验证')}
              </Button>
            )}
          </SettingsRow>
          {view.reason !== null && (
            <div
              data-testid="subscription-reason"
              className={cn(SETTINGS_ROW_CLS, 'min-h-0 py-2 text-meta text-content-tertiary')}
            >
              {view.reason}
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
        <SettingsSection title={t('额度')}>
          <SettingsCard>
            <QuotaRows windows={account.windows} now={now} />
          </SettingsCard>
        </SettingsSection>
        {steps !== undefined && (
          <SettingsSection title={t('最近步骤')}>
            <ListCard>
              {steps.length === 0 ? (
                <div className={cn(SETTINGS_ROW_CLS, 'text-meta text-content-tertiary')}>
                  {t('最近 24 小时没有步骤')}
                </div>
              ) : (
                steps.map((step) => <AccountStepRow key={step.stepId} step={step} now={now} />)
              )}
            </ListCard>
          </SettingsSection>
        )}
        {sticky.length > 0 && (
          <SettingsSection title={t('固定账户的 thread')}>
            <ListCard>
              {sticky.map((thread) => (
                <StickyThreadRow key={thread.threadId} thread={thread} now={now} />
              ))}
            </ListCard>
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

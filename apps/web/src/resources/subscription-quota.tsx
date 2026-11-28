import type { SubscriptionQuota } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import type { AccountVendor, QuotaWindow } from '../api/claude-accounts.js';
import { useLiveData } from '../api/provider.js';
import { useSubscriptionQuota } from '../api/subscription-quota.js';
import { useClock } from '../components/accounts/account-parts.js';
import { isLowQuota } from '../components/settings/quota-row.js';
import { SettingsCard, SettingsSection } from '../components/settings-list.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

const DAY = 86_400_000;

const WINDOW_LABELS = new Map([
  ['five_hour', '5 小时'],
  ['seven_day', '每周'],
  ['billing_period', '计费周期'],
  ['gemini-5h', 'Gemini · 5 小时'],
  ['gemini-weekly', 'Gemini · 每周'],
  ['3p-5h', 'Claude / GPT · 5 小时'],
  ['3p-weekly', 'Claude / GPT · 每周'],
]);

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

function resetsIn(
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

export function QuotaSection({
  id,
  kind,
  now,
  windows = [],
  stepsLast24h = null,
  revision = null,
}: {
  id: string;
  kind: AccountVendor;
  now: number;
  windows?: readonly QuotaWindow[];
  stepsLast24h?: number | null;
  revision?: string | number | null;
}) {
  const { live, teamId } = useLiveData();
  const at = useQuotaTime(now, live, windows);
  const ordered = currentQuotaWindows(windows, at);
  if (ordered.length)
    return <QuotaReadings now={at} windows={ordered} stepsLast24h={stepsLast24h} />;
  if (live && teamId) {
    return (
      <LiveQuota
        key={`${teamId}/${kind}/${id}/${revision}`}
        {...{ teamId, id, kind, now: at, revision, stepsLast24h }}
      />
    );
  }
  return <QuotaReadings now={at} stepsLast24h={stepsLast24h} />;
}

function useQuotaTime(
  now: number,
  live: boolean,
  windows: readonly QuotaWindow[],
  reset?: number | null,
) {
  const [clock, setClock] = useState(now);
  const at = Math.max(now, clock);
  let next = reset != null && reset > at ? reset : Infinity;
  for (const window of windows) {
    const expiry = window.resetsAt ?? window.observedAt + DAY;
    if (expiry > at) next = Math.min(expiry, next);
  }
  useEffect(() => {
    if (!live || next === Infinity) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(2_147_483_647, Math.max(0, next - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [live, next, at]);
  return at;
}

export function currentQuotaWindows(windows: readonly QuotaWindow[], now: number): QuotaWindow[] {
  return windows.filter((w) => (w.resetsAt === null ? w.observedAt > now - DAY : w.resetsAt > now));
}

function LiveQuota({
  teamId,
  kind,
  id,
  now,
  revision,
  stepsLast24h,
}: {
  teamId: string;
  kind: AccountVendor;
  id: string;
  now: number;
  revision: string | number | null;
  stepsLast24h: number | null;
}) {
  const query = useSubscriptionQuota(teamId, kind, id, revision);
  const at = useQuotaTime(now, true, query.data?.windows ?? [], query.data?.activity.resetsAt);
  return (
    <QuotaReadings
      now={at}
      windows={currentQuotaWindows(query.data?.windows ?? [], at)}
      activity={query.data?.activity}
      loading={query.isPending}
      stepsLast24h={stepsLast24h}
    />
  );
}

function QuotaReadings({
  now,
  windows = [],
  activity,
  loading,
  stepsLast24h,
}: {
  now: number;
  windows?: readonly QuotaWindow[];
  activity?: SubscriptionQuota['activity'] | undefined;
  loading?: boolean;
  stepsLast24h?: number | null;
}) {
  const { t } = useI18n();
  const clock = useClock();
  const ordered = quotaWindows(windows);
  const reset =
    activity?.resetsAt != null && activity.resetsAt > now
      ? resetsIn(activity.resetsAt, now, t, clock)
      : null;
  const lastDay =
    stepsLast24h == null ? null : (
      <div className="settings-row col-span-full flex min-h-11 items-center justify-between gap-2 py-2 text-meta text-content-secondary tabular-nums">
        <span>{t('近 24 小时')}</span>
        <span>{t('{n} 次运行', { n: stepsLast24h })}</span>
      </div>
    );
  return (
    <SettingsSection title={t('额度')} testId="subscription-quota">
      <span className="text-meta text-content-secondary">
        {ordered.length ? t('订阅额度') : t('Cairn 记录')}
      </span>
      {ordered.length ? (
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
          {lastDay}
        </SettingsCard>
      ) : (
        <SettingsCard>
          {loading ? (
            <div className="settings-row flex min-h-11 items-center py-2" role="status">
              <span className="sr-only">{t('正在读取额度')}</span>
              <Skeleton className="h-4 w-full" />
            </div>
          ) : activity === undefined ? (
            <div className="settings-row flex min-h-11 items-center justify-between gap-2 py-2 text-meta text-content-secondary tabular-nums">
              {t('读取额度失败')}
            </div>
          ) : (
            <>
              {(
                [
                  ['近 5 小时', activity.fiveHour],
                  ['近 7 天', activity.sevenDay],
                ] as const
              ).map(([label, counts]) => (
                <div
                  key={label}
                  className="settings-row flex min-h-11 flex-wrap items-center justify-between gap-x-2 py-2 text-meta tabular-nums"
                >
                  <span className="text-content-secondary">{t(label)}</span>
                  <span>
                    {t('{n} 次运行', { n: counts.runs })} · {t('{n} 次限流', { n: counts.limited })}
                  </span>
                </div>
              ))}
              {reset !== null && (
                <div
                  data-testid="subscription-quota-reset"
                  className="settings-row flex min-h-11 flex-wrap items-center justify-between gap-x-2 py-2 text-meta tabular-nums"
                >
                  <span className="text-content-secondary">{t('最近限流')}</span>
                  <span>{reset}</span>
                </div>
              )}
            </>
          )}
          {lastDay}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

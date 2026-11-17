import type { DailyUsage, DailyUsageDay } from '@cairn/shared';
import { cn } from 'cn';
import { ChartColumn, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTeams } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useDailyUsage } from '../api/usage-daily.js';
import { useNarrow } from '../board/use-narrow.js';
import { EmptyState } from '../components/empty-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { RouteDialog } from '../overlay/route-dialog.js';
import {
  axisMax,
  formatAxis,
  formatTokens,
  localDay,
  modelSeries,
  OTHER_MODELS,
  USAGE_FETCH_DAYS,
  USAGE_RANGES,
  type UsageRange,
  type UsageSummary,
  usageSummary,
} from '../usage/usage-model.js';

export const USAGE_PATH = '/app/usage';

const INKS = ['bg-(--heat-4)', 'bg-(--heat-2)', 'bg-(--heat-3)', 'bg-(--heat-1)'] as const;
const TYPE_INKS = ['bg-(--heat-4)', 'bg-(--heat-3)', 'bg-(--heat-2)', 'bg-(--heat-1)'] as const;

type Split = 'source' | 'model';

function useDateLabels() {
  const { locale } = useI18n();
  const intl = locale === 'zh' ? 'zh-CN' : 'en-US';
  const format = (options: Intl.DateTimeFormatOptions) => {
    const f = new Intl.DateTimeFormat(intl, { ...options, timeZone: 'UTC' });
    return (date: string) => f.format(new Date(`${date}T00:00:00Z`));
  };
  return {
    day: format({ month: 'long', day: 'numeric', weekday: 'short' }),
    short: format({ month: 'numeric', day: 'numeric' }),
  };
}

const percent = (share: number) =>
  share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`;
const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;

function Swatch({ ink }: { ink: string }) {
  return <i aria-hidden className={cn('block size-2 flex-none rounded-(--cds-radius-xs)', ink)} />;
}

function Stat({
  label,
  value,
  note,
  lead = false,
}: {
  label: string;
  value: string;
  note?: string;
  lead?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:px-6 sm:first:pl-0">
      <span className="text-meta text-content-tertiary">{label}</span>
      <span
        className={cn(
          'voice-title tabular-nums text-foreground',
          lead ? 'text-page' : 'text-brand',
        )}
      >
        {value}
      </span>
      {note !== undefined && (
        <span className="text-meta text-content-tertiary tabular-nums">{note}</span>
      )}
    </div>
  );
}

function Stats({ summary, range }: { summary: UsageSummary; range: UsageRange }) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const change =
    summary.change === null
      ? undefined
      : t('比上一个 {n} 天 {change}', {
          n: range,
          change: `${summary.change >= 0 ? '+' : '−'}${percent(Math.abs(summary.change))}`,
        });
  return (
    <div
      data-testid="usage-stats"
      className="grid grid-cols-3 gap-x-6 gap-y-5 sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-border"
    >
      <div className="col-span-3 sm:col-span-1">
        <Stat
          lead
          label={
            summary.since === null
              ? t('近 {n} 天', { n: range })
              : t('自 {date}', { date: labels.short(summary.since) })
          }
          value={`${formatTokens(summary.total)} token`}
          note={change}
        />
      </div>
      <Stat
        label="Coordinator"
        value={formatTokens(summary.coordinator)}
        note={summary.total > 0 ? percent(summary.coordinator / summary.total) : undefined}
      />
      <Stat
        label={t('任务')}
        value={formatTokens(summary.tasks)}
        note={t('{n} 个任务', { n: summary.tasksRun })}
      />
      <Stat
        label={t('缓存命中')}
        value={summary.cacheHit === null ? '0%' : percent(summary.cacheHit)}
        note={summary.cost === null ? undefined : t('按标价 {cost}', { cost: usd(summary.cost) })}
      />
    </div>
  );
}

function TokenMix({ summary }: { summary: UsageSummary }) {
  const { t } = useI18n();
  const parts = [
    [t('输入'), summary.input],
    [t('输出'), summary.output],
    [t('缓存读取'), summary.cacheRead],
    [t('缓存写入'), summary.cacheWrite],
  ] as const;
  return (
    <div data-testid="usage-mix" className="flex flex-col gap-2">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full">
        {parts.map(([label, tokens], i) =>
          tokens > 0 ? (
            <i key={label} className={cn('block', TYPE_INKS[i])} style={{ flexGrow: tokens }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-content-tertiary">
        {parts.map(([label, tokens], i) => (
          <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Swatch ink={TYPE_INKS[i] ?? ''} />
            {label}
            <span className="text-foreground tabular-nums">{formatTokens(tokens)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Chart({
  summary,
  split,
  modelName,
  active,
  onActive,
}: {
  summary: UsageSummary;
  split: Split;
  modelName: (key: string) => string;
  active: number | null;
  onActive: (index: number | null) => void;
}) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const { slots } = summary;
  const series = (day: DailyUsageDay) =>
    split === 'source' ? [day.coordinator, day.tasks] : modelSeries(day, summary.chartModels);
  const max = axisMax(
    Math.max(0, ...slots.map(({ day }) => (day ? day.coordinator + day.tasks : 0))),
  );
  const tick = (date: string, i: number) => {
    const n = slots.length;
    if (n <= 14)
      return i === 0 || date.endsWith('-01') ? labels.short(date) : String(Number(date.slice(8)));
    return (n - 1 - i) % (n <= 31 ? 7 : 14) === 0 ? labels.short(date) : '';
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    onActive(Math.min(slots.length - 1, Math.max(0, (active ?? slots.length) + by)));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-56 max-sm:h-44">
        {[1, 0.5, 0].map((level) => (
          <div
            key={level}
            aria-hidden
            className="absolute inset-x-0 flex items-center gap-2"
            style={{ top: `${(1 - level) * 100}%` }}
          >
            <span className="w-9 -translate-y-1/2 text-right font-mono text-caption text-content-tertiary">
              {level === 0 ? '0' : formatAxis(max * level)}
            </span>
            <span
              className={cn(
                'h-px flex-1 -translate-y-1/2',
                level === 0 ? 'bg-border' : 'border-t border-dashed border-border',
              )}
            />
          </div>
        ))}
        <div
          data-testid="usage-chart"
          role="slider"
          tabIndex={0}
          aria-label={t('按天用量')}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={slots.length - 1}
          aria-valuenow={active ?? slots.length - 1}
          aria-valuetext={labels.day(slots[active ?? slots.length - 1]?.date ?? '')}
          className="absolute inset-y-0 right-0 left-11 flex items-stretch rounded-(--cds-radius-sm) outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={move}
          onBlur={() => onActive(null)}
          onPointerLeave={() => onActive(null)}
        >
          {slots.map(({ date, day }, i) => {
            const values = day ? series(day) : [];
            const shown = values.map((v, k) => [v, k] as const).filter(([v]) => v > 0);
            return (
              <div
                key={date}
                data-day={date}
                data-active={active === i || undefined}
                className="group relative flex min-w-0 flex-1 flex-col-reverse items-center"
                onPointerEnter={() => onActive(i)}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 hidden w-px bg-border group-data-active:block"
                />
                <div className="relative flex h-full w-7/10 max-w-7 flex-col-reverse gap-px">
                  {shown.map(([value, k], j) => (
                    <i
                      key={k}
                      className={cn(
                        'block',
                        INKS[k],
                        j === shown.length - 1 && 'rounded-t-(--cds-radius-xs)',
                      )}
                      style={{ height: `${(value / max) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden className="ml-11 flex text-caption text-content-tertiary">
        {slots.map(({ date }, i) => (
          <span key={date} className="flex min-w-0 flex-1 justify-center overflow-visible">
            <span className="whitespace-nowrap tabular-nums">{tick(date, i)}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-content-tertiary">
        {(split === 'source'
          ? ['Coordinator', t('任务')]
          : summary.chartModels.map((key) => (key === OTHER_MODELS ? t('其他') : modelName(key)))
        ).map((label, k) => (
          <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Swatch ink={INKS[k] ?? INKS[3]} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Readout({
  summary,
  split,
  range,
  modelName,
  active,
}: {
  summary: UsageSummary;
  split: Split;
  range: UsageRange;
  modelName: (key: string) => string;
  active: number | null;
}) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const slot = active === null ? null : summary.slots[active];
  let text: string;
  if (!slot) {
    text =
      summary.since === null
        ? t('日均 {avg} · 用了 {n} 天', {
            avg: formatTokens(Math.round(summary.total / range)),
            n: summary.usedDays,
          })
        : t('{date} 开始使用 · 用了 {n} 天', {
            date: labels.short(summary.since),
            n: summary.usedDays,
          });
  } else if (!slot.day) {
    text = `${labels.day(slot.date)} · ${t('没有用量')}`;
  } else {
    const { day } = slot;
    const parts: [string, number][] =
      split === 'source'
        ? [
            ['Coordinator', day.coordinator],
            [t('任务'), day.tasks],
          ]
        : summary.chartModels
            .map((key, k): [string, number] => [
              key === OTHER_MODELS ? t('其他') : modelName(key),
              modelSeries(day, summary.chartModels)[k] ?? 0,
            ])
            .filter(([, v]) => v > 0);
    text = [
      labels.day(slot.date),
      `${formatTokens(day.coordinator + day.tasks)} token`,
      ...parts.map(([label, v]) => `${label} ${formatTokens(v)}`),
    ].join(' · ');
  }
  return (
    <p
      data-testid="usage-readout"
      aria-live="polite"
      className="m-0 min-w-0 truncate text-meta text-content-secondary tabular-nums"
    >
      {text}
    </p>
  );
}

function Ranking({
  testId,
  title,
  rows,
  total,
}: {
  testId: string;
  title: string;
  rows: { id: string; name: string; note?: string; tokens: number }[];
  total: number;
}) {
  const top = rows[0]?.tokens ?? 1;
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col">
      <h3 className="m-0 pb-1 text-ui font-medium text-foreground">{title}</h3>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 border-t border-border py-2.5"
        >
          <span className="truncate text-ui text-foreground">
            {row.name}
            {row.note !== undefined && (
              <span className="ml-1.5 text-meta text-content-tertiary">{row.note}</span>
            )}
          </span>
          <span className="font-mono text-meta tabular-nums text-foreground">
            {formatTokens(row.tokens)}
            <span className="ml-2 text-content-tertiary">{percent(row.tokens / total)}</span>
          </span>
          <span className="col-span-2 block h-0.5 rounded-full bg-(--heat-0)">
            <i
              className="block h-full rounded-full bg-(--heat-2)"
              style={{ width: `${(row.tokens / top) * 100}%` }}
            />
          </span>
        </div>
      ))}
    </section>
  );
}

function RangeTabs({ range, onChange }: { range: UsageRange; onChange: (r: UsageRange) => void }) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      label={t('时间范围')}
      value={String(range)}
      options={USAGE_RANGES.map((n) => ({
        value: String(n),
        label: t('{n} 天', { n }),
        testId: `usage-range-${n}`,
      }))}
      onChange={(next) => onChange(Number(next) as UsageRange)}
    />
  );
}

function UsageBody({
  usage,
  today,
  range,
  onRange,
}: {
  usage: DailyUsage;
  today: string;
  range: UsageRange;
  onRange: (r: UsageRange) => void;
}) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const [split, setSplit] = useState<Split>('source');
  const [active, setActive] = useState<number | null>(null);
  const summary = usageSummary(usage.days, today, range);
  const models = new Map(usage.models.map((model) => [model.key, model]));
  const projects = new Map(usage.projects.map((project) => [project.id, project.name]));
  const modelName = (key: string) => models.get(key)?.name ?? key;
  return (
    <div className="flex flex-col gap-7 px-7 pt-7 pb-8 max-sm:gap-6 max-sm:px-4 max-sm:pt-5">
      {narrow && <RangeTabs range={range} onChange={onRange} />}
      <Stats summary={summary} range={range} />
      <TokenMix summary={summary} />
      <div className="flex flex-col gap-3">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <SegmentedTabs
            quiet
            label={t('拆分')}
            value={split}
            options={[
              { value: 'source', label: t('来源'), testId: 'usage-split-source' },
              { value: 'model', label: t('模型'), testId: 'usage-split-model' },
            ]}
            onChange={(next) => setSplit(next)}
          />
          <Readout
            summary={summary}
            split={split}
            range={range}
            modelName={modelName}
            active={active}
          />
        </div>
        <Chart
          summary={summary}
          split={split}
          modelName={modelName}
          active={active}
          onActive={setActive}
        />
      </div>
      <div className="grid grid-cols-2 gap-8 max-sm:grid-cols-1 max-sm:gap-6">
        <Ranking
          testId="usage-models"
          title={t('模型')}
          total={summary.total}
          rows={summary.models.map(([key, tokens]) => ({
            id: key,
            name: modelName(key),
            note: models.get(key)?.provider,
            tokens,
          }))}
        />
        {summary.projects.length > 0 && (
          <Ranking
            testId="usage-projects"
            title={t('项目')}
            total={summary.tasks}
            rows={summary.projects.map(([id, tokens]) => ({
              id,
              name: projects.get(id) ?? t('已删除的项目'),
              tokens,
            }))}
          />
        )}
      </div>
    </div>
  );
}

export function UsagePage() {
  const { t } = useI18n();
  const narrow = useNarrow();
  const [params] = useSearchParams();
  const { live } = useLiveData();
  const fixture = resolveScenario(params);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(live ? Date.now() : fixture.now, tz);
  const teams = useTeams(live);
  const teamId = teams.isSuccess ? teams.data[0]?.id : undefined;
  const query = useDailyUsage(teamId, USAGE_FETCH_DAYS, tz, live);
  const usage = live ? query.data : (fixture.dailyUsage ?? { days: [], models: [], projects: [] });
  const failed = live && (teams.isError || query.isError);
  const [range, setRange] = useState<UsageRange>(30);
  const ready = !failed && usage !== undefined && usage.days.length > 0;

  return (
    <RouteDialog
      title={t('用量')}
      size="page"
      bleed
      actions={ready && !narrow ? <RangeTabs range={range} onChange={setRange} /> : undefined}
    >
      {failed ? (
        <EmptyState
          testId="usage-error"
          icon={TriangleAlert}
          title={t('用量加载失败')}
          description={t('检查网络后再试一次。')}
          action={{
            label: t('重试'),
            onClick: () => void (teams.isError ? teams.refetch() : query.refetch()),
            disabled: teams.isFetching || query.isFetching,
          }}
          className="h-full"
        />
      ) : usage === undefined ? (
        <div className="flex flex-col gap-7 px-7 pt-7" aria-busy="true">
          <span role="status" className="sr-only">
            {t('正在加载用量…')}
          </span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : usage.days.length === 0 ? (
        <EmptyState
          testId="usage-empty"
          icon={ChartColumn}
          title={t('还没有用量')}
          description={t('和 Coordinator 说第一句话后，这里会按天显示用了多少 token。')}
          className="h-full"
        />
      ) : (
        <UsageBody usage={usage} today={today} range={range} onRange={setRange} />
      )}
    </RouteDialog>
  );
}

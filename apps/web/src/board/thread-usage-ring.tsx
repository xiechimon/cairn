import { cn } from 'cn';
import {
  ContextMeterGlyph,
  ContextMeterPanel,
  contextGlyphProps,
  contextMeterLines,
  contextPercentOf,
  METER_BTN_CLS,
  useContextClock,
} from '../chief/context-meter-ring.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { ChiefContextUsage } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { type ThreadUsageSummary, threadUsageCaption } from './thread-usage-model.js';

export type ThreadUsageState = 'ready' | 'loading' | 'error';

export interface ThreadUsageView {
  summary: ThreadUsageSummary;
  state: ThreadUsageState;
  onRetry: () => void;
  context?: ChiefContextUsage | null | undefined;
}

const UNKNOWN = '—';

export function threadUsageShown(summary: ThreadUsageSummary, state: ThreadUsageState): boolean {
  return (
    state !== 'ready' ||
    summary.cost !== UNKNOWN ||
    summary.tokens !== UNKNOWN ||
    summary.models.length > 0 ||
    summary.machines.length > 0 ||
    summary.duration !== '' ||
    summary.engines.length > 0
  );
}

function usageStatus(summary: ThreadUsageSummary, state: ThreadUsageState, t: TFunc): string {
  return state === 'loading'
    ? t('正在加载用量…')
    : state === 'error'
      ? t('用量加载失败')
      : threadUsageCaption(summary, t);
}

export function ThreadUsageDetails({
  summary,
  state,
  onRetry,
  context,
  running = false,
  className,
}: ThreadUsageView & { running?: boolean; className?: string }) {
  const { t } = useI18n();
  const reading = context ?? null;
  const now = useContextClock(reading);
  const rows = [
    { label: t('引擎'), value: summary.engines.join(' · ') },
    { label: t('时长'), value: summary.duration },
    { label: t('花费'), value: summary.cost },
    { label: t('Token 数'), value: summary.tokens },
    { label: t('缓存命中'), value: summary.cached },
    { label: t('模型列表'), value: summary.models.join(' · ') },
    { label: t('执行机'), value: summary.machines.join(' · ') },
  ].filter((row) => row.value !== '');
  return (
    <section
      data-testid="thread-usage"
      data-state={state}
      aria-label={t('对话用量')}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      {reading !== null && contextPercentOf(reading) !== null && (
        <ContextMeterPanel
          context={reading}
          running={running}
          now={now}
          className="mb-1 border-b border-border pb-3"
        />
      )}
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="m-0 text-ui font-medium text-foreground">{t('用量')}</h3>
        {state === 'error' && (
          <Button variant="outline" size="xs" data-testid="thread-usage-retry" onClick={onRetry}>
            {t('重试')}
          </Button>
        )}
      </div>
      <dl
        data-testid="thread-usage-stats"
        className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui"
      >
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-content-secondary">{row.label}</dt>
            <dd className="m-0 text-right break-words text-foreground tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-caption text-content-tertiary">
        {summary.duration === '' ? t('包含全部运行；总时长暂不可用。') : t('包含全部运行。')}
      </p>
      {state !== 'ready' && (
        <p
          role="status"
          className={cn(
            'm-0 text-meta',
            state === 'error' ? 'text-destructive' : 'text-content-tertiary',
          )}
        >
          {usageStatus(summary, state, t)}
        </p>
      )}
    </section>
  );
}

export function ThreadUsageRing(view: ThreadUsageView & { running?: boolean }) {
  const { t } = useI18n();
  const { summary, state } = view;
  const context = view.context ?? null;
  const now = useContextClock(context);
  const percent = contextPercentOf(context);
  const lines =
    context === null || percent === null
      ? []
      : contextMeterLines(t, context, { running: view.running ?? false, now });
  const usage = threadUsageShown(summary, state) ? usageStatus(summary, state, t) : null;
  const reading = lines.length === 0 ? null : lines.join(', ');
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={reading ?? t('对话用量')}
                  aria-description={reading === null ? undefined : t('对话用量')}
                  data-testid="thread-usage-ring"
                  data-state={state}
                  data-percent={percent ?? undefined}
                  className={cn(METER_BTN_CLS, 'cursor-pointer aria-expanded:bg-(--menu-hover)')}
                />
              }
            />
          }
        >
          <ContextMeterGlyph
            key={percent === null ? 'pending' : 'read'}
            {...contextGlyphProps(context, percent ?? 0)}
          />
          {percent !== null && <span aria-hidden="true">{`${percent}%`}</span>}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="flex-col items-start gap-0.5">
          {[...lines, ...(usage === null ? [] : [usage])].map((line, index) => (
            <span key={line} className={index === 0 ? undefined : 'opacity-80'}>
              {line}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-80 p-3.5">
        <ThreadUsageDetails {...view} />
      </PopoverContent>
    </Popover>
  );
}

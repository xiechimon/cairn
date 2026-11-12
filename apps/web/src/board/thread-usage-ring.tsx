import { cn } from 'cn';
import { ContextMeterGlyph, METER_BTN_CLS } from '../chief/context-meter-ring.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { type ThreadUsageSummary, threadUsageCaption } from './thread-usage-model.js';

export type ThreadUsageState = 'ready' | 'loading' | 'error';

export interface ThreadUsageView {
  summary: ThreadUsageSummary;
  state: ThreadUsageState;
  onRetry: () => void;
}

const UNKNOWN = '—';

export function threadUsageShown(summary: ThreadUsageSummary, state: ThreadUsageState): boolean {
  return (
    state !== 'ready' ||
    summary.cost !== UNKNOWN ||
    summary.tokens !== UNKNOWN ||
    summary.models.length > 0 ||
    summary.machines.length > 0
  );
}

export function threadUsageRingPercent(summary: ThreadUsageSummary): number {
  const cached = Number.parseFloat(summary.cached);
  return Number.isFinite(cached) ? cached : 0;
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
  className,
}: ThreadUsageView & { className?: string }) {
  const { t } = useI18n();
  const rows = [
    { label: t('花费'), value: summary.cost },
    { label: t('Token 数'), value: summary.tokens },
    { label: t('缓存命中'), value: summary.cached },
    { label: t('模型列表'), value: summary.models.join(' · ') },
    { label: t('机器'), value: summary.machines.join(' · ') },
  ].filter((row) => row.value !== '');
  return (
    <section
      data-testid="thread-usage"
      data-state={state}
      aria-label={t('thread 用量')}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
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
        {t('包含全部运行；总时长暂不可用。')}
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

export function ThreadUsageRing(view: ThreadUsageView) {
  const { t } = useI18n();
  const { summary, state } = view;
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
                  aria-label={t('thread 用量')}
                  data-testid="thread-usage-ring"
                  data-state={state}
                  className={cn(METER_BTN_CLS, 'cursor-pointer aria-expanded:bg-(--menu-hover)')}
                />
              }
            />
          }
        >
          <ContextMeterGlyph filled={threadUsageRingPercent(summary)} />
          {state === 'ready' && summary.tokens !== UNKNOWN && (
            <span aria-hidden="true">{summary.tokens}</span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {usageStatus(summary, state, t)}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 p-3.5">
        <ThreadUsageDetails {...view} />
      </PopoverContent>
    </Popover>
  );
}

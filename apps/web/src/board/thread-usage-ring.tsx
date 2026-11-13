import { cn } from 'cn';
import { ContextMeterGlyph, contextPercentOf, METER_BTN_CLS } from '../chief/context-meter-ring.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { formatWorkDuration } from '../detail/work-trace.js';
import type { ChiefContextUsage } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ENGINE_CHOICE_WORDS, type EngineRun, engineCost } from './engine-run.js';
import {
  type ThreadUsageSummary,
  threadContextReading,
  threadUsageCaption,
} from './thread-usage-model.js';

export type ThreadUsageState = 'ready' | 'loading' | 'error';

export interface ThreadUsageView {
  summary: ThreadUsageSummary;
  state: ThreadUsageState;
  onRetry: () => void;
  context?: ChiefContextUsage | null | undefined;
  engineRun?: EngineRun | undefined;
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
  engineRun,
  className,
}: ThreadUsageView & { className?: string }) {
  const { t } = useI18n();
  const rows = [
    { label: t('上下文'), value: threadContextReading(context) },
    ...(engineRun === undefined
      ? []
      : [
          {
            label: t('时长'),
            value:
              engineRun.elapsedSeconds === null ? '' : formatWorkDuration(engineRun.elapsedSeconds),
          },
          {
            label: t('模型档位'),
            value: `${t(ENGINE_CHOICE_WORDS.modelTier[engineRun.choice.modelTier])} · ${t(ENGINE_CHOICE_WORDS.effort[engineRun.choice.effort])}`,
          },
          { label: t('选择理由'), value: engineRun.choice.reason },
        ]),
    { label: t('花费'), value: engineCost(engineRun?.costUsd ?? null) ?? summary.cost },
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
      {engineRun === undefined && (
        <p className="m-0 text-caption text-content-tertiary">
          {t('包含全部运行；总时长暂不可用。')}
        </p>
      )}
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
  const percent = contextPercentOf(view.context);
  const reading = percent === null ? null : t('上下文 {percent}%', { percent });
  const usage = threadUsageShown(summary, state) ? usageStatus(summary, state, t) : null;
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
                  aria-label={reading ?? t('thread 用量')}
                  aria-description={reading === null ? undefined : t('thread 用量')}
                  data-testid="thread-usage-ring"
                  data-state={state}
                  data-percent={percent ?? undefined}
                  className={cn(METER_BTN_CLS, 'cursor-pointer aria-expanded:bg-(--menu-hover)')}
                />
              }
            />
          }
        >
          <ContextMeterGlyph filled={percent ?? 0} />
          {percent !== null && <span aria-hidden="true">{`${percent}%`}</span>}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {[reading, usage].filter((part) => part !== null).join(' · ')}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-80 p-3.5">
        <ThreadUsageDetails {...view} />
      </PopoverContent>
    </Popover>
  );
}

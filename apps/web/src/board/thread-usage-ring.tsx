import { cn } from 'cn';
import { useState } from 'react';
import {
  ContextMeterGlyph,
  ContextMeterPanel,
  contextGlyphProps,
  contextMeterLines,
  contextPercentOf,
  METER_BTN_CLS,
} from '../chief/context-meter-ring.js';
import { engineRuntimeOf, resolveModelClientEntry } from '../components/model-identity.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import {
  UsageBreakdownSection,
  type UsageEngineItem,
  type UsageModelItem,
  type UsageRunnerItem,
} from '../components/usage-breakdown.js';
import { PopoverDismissEffect } from '../components/use-dismiss-on-overlay.js';
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

export function threadUsageShown(summary: ThreadUsageSummary, state: ThreadUsageState): boolean {
  return (
    state !== 'ready' ||
    (summary.cost !== '' && summary.cost !== '—') ||
    (summary.tokens !== '' && summary.tokens !== '—') ||
    (summary.cached !== '' && summary.cached !== '—') ||
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
  className,
}: ThreadUsageView & { running?: boolean; className?: string }) {
  const { t } = useI18n();
  const reading = context ?? null;
  const fallbackEngine = summary.engines.at(-1);
  const latestEngine: UsageEngineItem | null =
    summary.latestEngine !== undefined
      ? summary.latestEngine
      : fallbackEngine !== undefined
        ? {
            label: fallbackEngine,
            runtime: engineRuntimeOf(fallbackEngine),
          }
        : null;
  const historyEngines: UsageEngineItem[] =
    summary.historyEngines ??
    summary.engines
      .filter((label) => label !== latestEngine?.label)
      .reverse()
      .map((label) => ({ label, runtime: engineRuntimeOf(label) }));

  const fallbackModels: UsageModelItem[] = summary.models.map((m) => resolveModelClientEntry(m));
  const latestModel: UsageModelItem | null =
    summary.latestModel !== undefined ? summary.latestModel : (fallbackModels.at(-1) ?? null);
  const historyModels: UsageModelItem[] =
    summary.historyModels ??
    [...fallbackModels].reverse().filter((m) => latestModel === null || m.raw !== latestModel.raw);

  const fallbackRunners: UsageRunnerItem[] = summary.machines.map((name) => ({ id: null, name }));
  const latestRunner: UsageRunnerItem | null =
    summary.latestMachine !== undefined ? summary.latestMachine : (fallbackRunners.at(-1) ?? null);
  const historyRunners: UsageRunnerItem[] =
    summary.historyMachines ??
    [...fallbackRunners]
      .reverse()
      .filter((r) => latestRunner === null || r.name !== latestRunner.name);

  const data = {
    duration: summary.duration,
    cost: summary.cost,
    tokens: summary.tokens,
    cached: summary.cached,
    latestEngine,
    historyEngines,
    latestModel,
    historyModels,
    latestRunner,
    historyRunners,
  };
  return (
    <section
      data-testid="thread-usage"
      data-state={state}
      aria-label={t('对话用量')}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      {reading !== null && contextPercentOf(reading) !== null && (
        <ContextMeterPanel context={reading} className="mb-1 border-b border-border pb-3" />
      )}
      <UsageBreakdownSection
        as="div"
        data={data}
        testId="thread-usage-breakdown"
        statsTestId="thread-usage-stats"
        headerAction={
          state === 'error' ? (
            <Button variant="outline" size="xs" data-testid="thread-usage-retry" onClick={onRetry}>
              {t('重试')}
            </Button>
          ) : undefined
        }
        footer={
          <>
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
          </>
        }
      />
    </section>
  );
}

export function ThreadUsageRing(view: ThreadUsageView & { running?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { summary, state } = view;
  const context = view.context ?? null;
  const percent = contextPercentOf(context);
  const lines = context === null || percent === null ? [] : contextMeterLines(t, context);
  const usage = threadUsageShown(summary, state) ? usageStatus(summary, state, t) : null;
  const reading = lines.length === 0 ? null : lines.join(', ');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverDismissEffect open={open} onClose={() => setOpen(false)} />
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
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="flex-col items-start gap-0.5">
          {[...lines, ...(usage === null ? [] : [usage])].map((line, index) => (
            <span key={line} className={index === 0 ? undefined : 'opacity-80'}>
              {line}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        data-usage-popover="true"
        side="top"
        align="end"
        sideOffset={8}
        className="w-80 p-3.5"
      >
        <ThreadUsageDetails {...view} />
      </PopoverContent>
    </Popover>
  );
}

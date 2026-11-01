import { cn } from 'cn';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { Check, X } from '../../icons/index.js';
import {
  EMPTY_TRACE_COUNTS,
  TraceCard,
  TraceCommandBox,
  type TraceCounts,
  TraceFailTag,
  TraceGroupSummary,
  TraceOutput,
  TraceRowButton,
  traceSummary,
} from './trace-parts.js';

export type TraceStep =
  | { kind: 'think'; text: string; secs: number }
  | { kind: 'say'; text: string }
  | { kind: 'read'; path: string; lines: number; secs: number }
  | { kind: 'search'; query: string; hits: number; secs: number }
  | { kind: 'run'; command: string; exit: number | null; output: string[]; secs: number }
  | { kind: 'edit'; path: string; added: number; removed: number; secs: number }
  | { kind: 'push'; branch: string; commit: string; secs: number }
  | {
      kind: 'tool';
      verb?: string;
      name: string;
      status: 'done' | 'running' | 'failed';
      secs?: number;
    }
  | { kind: 'wait'; text: string }
  | { kind: 'check'; label: string; ok: boolean };

export type TraceDensity = 'comfortable' | 'compact';

type ActionStep = Exclude<TraceStep, { kind: 'say' | 'wait' | 'check' }>;

export interface TraceStepItem {
  id: number | string;
  step: TraceStep;
}

function isAction(step: TraceStep): step is ActionStep {
  return step.kind !== 'say' && step.kind !== 'wait' && step.kind !== 'check';
}

function isRunning(step: ActionStep): boolean {
  if (step.kind === 'run') return step.exit == null;
  if (step.kind === 'tool') return step.status === 'running';
  return false;
}

function isFailed(step: ActionStep): boolean {
  if (step.kind === 'run') return step.exit != null && step.exit !== 0;
  if (step.kind === 'tool') return step.status === 'failed';
  return false;
}

export function traceCounts(steps: TraceStep[]): TraceCounts {
  const counts = { ...EMPTY_TRACE_COUNTS };
  for (const step of steps) {
    if (!isAction(step)) continue;
    counts[step.kind] += 1;
    if (isFailed(step)) counts.failed += 1;
  }
  return counts;
}

export function TraceCode({ children }: { children: ReactNode }) {
  return <span className="font-medium text-(--foreground)">{children}</span>;
}

function Secs({ secs }: { secs: number | undefined }) {
  if (secs == null || secs <= 0) return null;
  return <span className="text-caption text-(--text-tertiary)">{secs}s</span>;
}

function Diff({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="font-mono text-code font-medium">
      <span className="text-running-text">+{added}</span>{' '}
      <span className="text-destructive">−{removed}</span>
    </span>
  );
}

function RowDetail({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-3">{children}</div>;
}

function ActionRow({ step, compact }: { step: ActionStep; compact: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(isFailed(step));
  const running = isRunning(step);
  const common = { compact, running } as const;
  switch (step.kind) {
    case 'think':
      return (
        <div>
          <TraceRowButton
            {...common}
            verb={t('思考了')}
            target={`${step.secs}s`}
            expandable
            open={open}
            onClick={() => setOpen((v) => !v)}
          />
          {open && (
            <RowDetail>
              <p className="m-0 text-meta leading-5 text-(--text-secondary) italic">{step.text}</p>
            </RowDetail>
          )}
        </div>
      );
    case 'read':
      return (
        <TraceRowButton
          {...common}
          verb={t('读取了')}
          target={step.path}
          trailing={<Secs secs={step.secs} />}
        />
      );
    case 'search':
      return (
        <TraceRowButton
          {...common}
          verb={t('搜索了')}
          target={step.query}
          trailing={<Secs secs={step.secs} />}
        />
      );
    case 'edit':
      return (
        <TraceRowButton
          {...common}
          verb={t('修改了')}
          target={step.path}
          trailing={
            <>
              <Diff added={step.added} removed={step.removed} />
              <Secs secs={step.secs} />
            </>
          }
        />
      );
    case 'push':
      return (
        <TraceRowButton
          {...common}
          verb={t('推送了')}
          target={step.branch}
          trailing={
            <>
              <span className="font-mono text-code">{step.commit}</span>
              <Secs secs={step.secs} />
            </>
          }
        />
      );
    case 'tool':
      return (
        <TraceRowButton
          {...common}
          verb={step.verb ?? t(running ? '正在调用' : '调用了')}
          target={step.name}
          trailing={
            <>
              {step.status === 'failed' && <TraceFailTag>{t('失败')}</TraceFailTag>}
              <Secs secs={step.secs} />
            </>
          }
        />
      );
    case 'run':
      return (
        <div>
          <TraceRowButton
            {...common}
            verb={t(running ? '正在运行' : '运行了')}
            target={step.command}
            mono
            expandable
            open={open}
            onClick={() => setOpen((v) => !v)}
            trailing={
              <>
                {isFailed(step) && <TraceFailTag>{`exit ${step.exit}`}</TraceFailTag>}
                <Secs secs={step.secs} />
              </>
            }
          />
          {open && (
            <RowDetail>
              <TraceCommandBox command={step.command} />
              {step.output.length > 0 && (
                <TraceOutput className={isFailed(step) ? 'text-destructive' : undefined}>
                  {step.output.join('\n')}
                </TraceOutput>
              )}
            </RowDetail>
          )}
        </div>
      );
  }
}

export function TraceRows({
  steps,
  density = 'comfortable',
  className,
  ...props
}: {
  steps: TraceStepItem[];
  density?: TraceDensity;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <TraceCard className={className} {...props}>
      {steps.map(({ id, step }) =>
        isAction(step) ? <ActionRow key={id} step={step} compact={density === 'compact'} /> : null,
      )}
    </TraceCard>
  );
}

export function TraceGroup({
  steps,
  density = 'comfortable',
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  summaryTestId,
  cardTestId,
  className,
}: {
  steps: TraceStepItem[];
  density?: TraceDensity;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  summaryTestId?: string;
  cardTestId?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const actions = steps.filter((s): s is TraceStepItem & { step: ActionStep } => isAction(s.step));
  const counts = traceCounts(actions.map((s) => s.step));
  const running = actions.some((s) => isRunning(s.step));
  const { text, failed } = traceSummary(t, counts, running);
  return (
    <div className={cn('mb-3 min-w-0', className)}>
      <TraceGroupSummary
        summary={text}
        failed={failed}
        open={open}
        running={running}
        compact={density === 'compact'}
        data-testid={summaryTestId}
        onClick={() => {
          const next = !open;
          setInnerOpen(next);
          onOpenChange?.(next);
        }}
      />
      {open && <TraceRows steps={actions} density={density} data-testid={cardTestId} />}
    </div>
  );
}

function CheckChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-meta font-medium',
        ok ? 'bg-(--chip-done-bg) text-(--chip-done-fg)' : 'bg-danger-soft text-destructive',
      )}
    >
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded-full text-(--switch-thumb)',
          ok ? 'bg-running-bar' : 'bg-destructive',
        )}
      >
        {ok ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      {label}
    </div>
  );
}

type Block =
  | { type: 'group'; key: number | string; steps: TraceStepItem[] }
  | { type: 'line'; key: number | string; step: Exclude<TraceStep, ActionStep> };

function toBlocks(steps: TraceStepItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of steps) {
    if (isAction(item.step)) {
      const last = blocks.at(-1);
      if (last?.type === 'group') last.steps.push(item);
      else blocks.push({ type: 'group', key: item.id, steps: [item] });
    } else blocks.push({ type: 'line', key: item.id, step: item.step });
  }
  return blocks;
}

export function TraceSteps({
  steps,
  density = 'comfortable',
  defaultOpen = false,
  className,
}: {
  steps: TraceStepItem[];
  density?: TraceDensity;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {toBlocks(steps).map((block) => {
        if (block.type === 'group')
          return (
            <TraceGroup
              key={block.key}
              steps={block.steps}
              density={density}
              defaultOpen={defaultOpen}
            />
          );
        const { step } = block;
        if (step.kind === 'say')
          return (
            <p key={block.key} className="m-0 mb-3 text-card-title leading-6 text-foreground">
              {step.text}
            </p>
          );
        if (step.kind === 'wait')
          return (
            <p key={block.key} className="m-0 mb-3 text-ui leading-6 text-(--text-tertiary)">
              {step.text}
            </p>
          );
        return (
          <div key={block.key} className="mb-3">
            <CheckChip label={step.label} ok={step.ok} />
          </div>
        );
      })}
    </div>
  );
}

import { cn } from 'cn';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import {
  Check,
  FileText,
  GitBranch,
  Puzzle,
  Search,
  Sparkle,
  SquarePen,
  Terminal,
  X,
} from '../../icons/index.js';
import { CODE_PILL_CLS } from '../code-pill.js';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../ui/trace.js';

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

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const LINE: Record<TraceDensity, string> = {
  comfortable: 'text-ui text-content-secondary',
  compact: 'text-meta leading-5 text-content-secondary',
};

const RUNNING_VERB =
  'data-running:[&_[data-trace-verb]]:shimmer motion-reduce:data-running:[&_[data-trace-verb]]:shimmer-none';

export function TraceCode({ children }: { children: ReactNode }) {
  return <code className={CODE_PILL_CLS}>{children}</code>;
}

function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-meta text-content-tertiary', className)}>{children}</span>;
}

export function TraceFailed({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-destructive">
      <X className="size-3.5" />
      {label}
    </span>
  );
}

function ExitBadge({ exit }: { exit: number }) {
  if (exit !== 0) return <TraceFailed label={`exit ${exit}`} />;
  return (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-running-text">
      <Check className="size-3.5" />
      exit 0
    </span>
  );
}

function ToolLine({
  icon: Glyph,
  density,
  failed = false,
  running = false,
  children,
  secs,
  trailing,
}: {
  icon?: Icon;
  density: TraceDensity;
  failed?: boolean;
  running?: boolean;
  children: ReactNode;
  secs?: number | undefined;
  trailing?: ReactNode;
}) {
  return (
    <TraceLine data-running={running ? '' : undefined} className={cn(LINE[density], RUNNING_VERB)}>
      {Glyph != null && (
        <TraceIcon className={failed ? 'text-destructive' : undefined}>
          <Glyph />
        </TraceIcon>
      )}
      <TraceTitle>{children}</TraceTitle>
      {trailing}
      {secs != null && secs > 0 && <TraceDescription>{secs}s</TraceDescription>}
    </TraceLine>
  );
}

export function TraceStepLine({
  step,
  density = 'comfortable',
  failedLabel = 'Failed',
}: {
  step: TraceStep;
  density?: TraceDensity;
  failedLabel?: string;
}) {
  const line = LINE[density];
  switch (step.kind) {
    case 'say':
      return <p className="m-0 py-1 text-card-title leading-6 text-foreground">{step.text}</p>;
    case 'wait':
      return (
        <TraceLine className={cn(line, 'text-content-tertiary')}>
          <TraceTitle>{step.text}</TraceTitle>
        </TraceLine>
      );
    case 'think':
      return (
        <TraceCollapsible>
          <TraceCollapsibleTrigger className={line}>
            <TraceLine className={line}>
              <TraceIcon className="text-content-tertiary">
                <Sparkle />
              </TraceIcon>
              <TraceTitle className="text-content-tertiary italic">
                Thought for {step.secs}s
              </TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="text-meta italic">
            {step.text}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      );
    case 'search':
      return (
        <ToolLine
          icon={Search}
          density={density}
          secs={step.secs}
          trailing={<Meta>{step.hits} results</Meta>}
        >
          Searched <TraceCode>{step.query}</TraceCode>
        </ToolLine>
      );
    case 'read':
      return (
        <ToolLine
          icon={FileText}
          density={density}
          secs={step.secs}
          trailing={<Meta>{step.lines} lines</Meta>}
        >
          Read <TraceCode>{step.path}</TraceCode>
        </ToolLine>
      );
    case 'edit':
      return (
        <ToolLine
          icon={SquarePen}
          density={density}
          secs={step.secs}
          trailing={
            <span className="font-mono text-code font-medium tabular-nums">
              <span className="text-running-text">+{step.added}</span>{' '}
              <span className="text-destructive">−{step.removed}</span>
            </span>
          }
        >
          Edited <TraceCode>{step.path}</TraceCode>
        </ToolLine>
      );
    case 'push':
      return (
        <ToolLine
          icon={GitBranch}
          density={density}
          secs={step.secs}
          trailing={<Meta className="font-mono text-code">{step.commit}</Meta>}
        >
          Pushed <TraceCode>{step.branch}</TraceCode>
        </ToolLine>
      );
    case 'tool':
      return (
        <ToolLine
          icon={Puzzle}
          density={density}
          running={step.status === 'running'}
          failed={step.status === 'failed'}
          secs={step.secs}
          trailing={step.status === 'failed' ? <TraceFailed label={failedLabel} /> : undefined}
        >
          {step.verb != null && <span data-trace-verb="">{step.verb} </span>}
          <TraceCode>{step.name}</TraceCode>
        </ToolLine>
      );
    case 'run': {
      const head = (
        <ToolLine
          icon={Terminal}
          density={density}
          running={step.exit == null}
          failed={step.exit != null && step.exit !== 0}
          secs={step.secs}
          trailing={step.exit == null ? undefined : <ExitBadge exit={step.exit} />}
        >
          <span data-trace-verb="">{step.exit == null ? 'Running' : 'Ran'} </span>
          <TraceCode>{step.command}</TraceCode>
        </ToolLine>
      );
      if (step.output.length === 0) return head;
      return (
        <TraceCollapsible defaultOpen={step.exit != null && step.exit !== 0}>
          <TraceCollapsibleTrigger className={line}>{head}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="font-mono text-code leading-5 not-italic">
            {step.output.map((out) => (
              <div key={out} className={step.exit === 0 ? '' : 'text-destructive'}>
                {out}
              </div>
            ))}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      );
    }
    case 'check':
      return (
        <div
          className={cn(
            'flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-meta font-medium',
            step.ok
              ? 'bg-(--chip-done-bg) text-(--chip-done-fg)'
              : 'bg-danger-soft text-destructive',
          )}
        >
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded-full text-(--switch-thumb)',
              step.ok ? 'bg-running-bar' : 'bg-destructive',
            )}
          >
            {step.ok ? <Check className="size-3" /> : <X className="size-3" />}
          </span>
          {step.label}
        </div>
      );
  }
}

export function TraceSteps({
  steps,
  density = 'comfortable',
  className,
}: {
  steps: { id: number | string; step: TraceStep }[];
  density?: TraceDensity;
  className?: string;
}) {
  return (
    <Trace className={cn(density === 'compact' ? 'gap-1.5' : 'gap-2.5', className)}>
      {steps.map(({ id, step }) => (
        <TraceStepLine key={id} step={step} density={density} />
      ))}
    </Trace>
  );
}

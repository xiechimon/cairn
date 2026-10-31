import type { ComponentType, ReactNode, SVGProps } from 'react';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../components/ui/trace.js';
import {
  Check,
  FileText,
  GitBranch,
  Search,
  Sparkle,
  SquarePen,
  Terminal,
  X,
} from '../icons/index.js';

export type TranscriptStep =
  | { kind: 'think'; text: string; secs: number }
  | { kind: 'say'; text: string }
  | { kind: 'read'; path: string; lines: number; secs: number }
  | { kind: 'search'; query: string; hits: number; secs: number }
  | { kind: 'run'; command: string; exit: number; output: string[]; secs: number }
  | { kind: 'edit'; path: string; added: number; removed: number; secs: number }
  | { kind: 'push'; branch: string; commit: string; secs: number }
  | { kind: 'check'; label: string; ok: boolean };

export const SEED_TRANSCRIPT: TranscriptStep[] = [
  {
    kind: 'think',
    text: 'CI fails at the frozen install, so the lockfile and package.json disagree. Check the last commit first.',
    secs: 3,
  },
  { kind: 'search', query: 'ERR_PNPM_OUTDATED_LOCKFILE', hits: 2, secs: 1 },
  { kind: 'read', path: 'package.json', lines: 64, secs: 1 },
  {
    kind: 'say',
    text: 'The last commit bumped vitest in package.json without updating pnpm-lock.yaml.',
  },
  {
    kind: 'run',
    command: 'pnpm install --frozen-lockfile',
    exit: 1,
    output: [
      'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"',
      'specifiers in the lockfile do not match package.json',
    ],
    secs: 4,
  },
  {
    kind: 'run',
    command: 'pnpm install',
    exit: 0,
    output: ['Lockfile is up to date, resolution step is skipped', 'Done in 11.2s'],
    secs: 12,
  },
  { kind: 'edit', path: 'pnpm-lock.yaml', added: 18, removed: 6, secs: 1 },
  { kind: 'push', branch: 'fix/lockfile', commit: '3f2a91c', secs: 3 },
  { kind: 'check', label: 'CI passed on 3f2a91c', ok: true },
];

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const CODE_PILL =
  'rounded-(--cds-radius-sm) bg-secondary px-1.5 py-px font-mono text-caption text-foreground';
const LINE = 'text-ui text-content-secondary';

function Code({ children }: { children: ReactNode }) {
  return <code className={CODE_PILL}>{children}</code>;
}

function ToolLine({
  icon: Glyph,
  iconClassName,
  children,
  secs,
  trailing,
}: {
  icon: Icon;
  iconClassName?: string;
  children: ReactNode;
  secs?: number;
  trailing?: ReactNode;
}) {
  return (
    <TraceLine className={LINE}>
      <TraceIcon className={iconClassName}>
        <Glyph />
      </TraceIcon>
      <TraceTitle>{children}</TraceTitle>
      {trailing}
      {secs != null && secs > 0 && <TraceDescription>{secs}s</TraceDescription>}
    </TraceLine>
  );
}

function ExitBadge({ exit }: { exit: number }) {
  const ok = exit === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-meta font-medium ${ok ? 'text-running-text' : 'text-destructive'}`}
    >
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      exit {exit}
    </span>
  );
}

export function TranscriptLine({ step }: { step: TranscriptStep }) {
  switch (step.kind) {
    case 'say':
      return <p className="m-0 py-1 text-card-title leading-6 text-foreground">{step.text}</p>;
    case 'think':
      return (
        <TraceCollapsible>
          <TraceCollapsibleTrigger className={LINE}>
            <TraceLine className={LINE}>
              <TraceIcon className="text-content-tertiary">
                <Sparkle />
              </TraceIcon>
              <TraceTitle className="italic text-content-tertiary">
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
          secs={step.secs}
          trailing={<span className="text-meta text-content-tertiary">{step.hits} results</span>}
        >
          Searched <Code>{step.query}</Code>
        </ToolLine>
      );
    case 'read':
      return (
        <ToolLine
          icon={FileText}
          secs={step.secs}
          trailing={<span className="text-meta text-content-tertiary">{step.lines} lines</span>}
        >
          Read <Code>{step.path}</Code>
        </ToolLine>
      );
    case 'edit':
      return (
        <ToolLine
          icon={SquarePen}
          secs={step.secs}
          trailing={
            <span className="font-mono text-caption font-medium tabular-nums">
              <span className="text-running-text">+{step.added}</span>{' '}
              <span className="text-destructive">−{step.removed}</span>
            </span>
          }
        >
          Edited <Code>{step.path}</Code>
        </ToolLine>
      );
    case 'push':
      return (
        <ToolLine
          icon={GitBranch}
          secs={step.secs}
          trailing={
            <span className="font-mono text-caption text-content-tertiary">{step.commit}</span>
          }
        >
          Pushed <Code>{step.branch}</Code>
        </ToolLine>
      );
    case 'run':
      return (
        <TraceCollapsible defaultOpen={step.exit !== 0}>
          <TraceCollapsibleTrigger className={LINE}>
            <ToolLine
              icon={Terminal}
              iconClassName={step.exit === 0 ? undefined : 'text-destructive'}
              secs={step.secs}
              trailing={<ExitBadge exit={step.exit} />}
            >
              Ran <Code>{step.command}</Code>
            </ToolLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="font-mono text-caption leading-5 not-italic">
            {step.output.map((line) => (
              <div key={line} className={step.exit === 0 ? '' : 'text-destructive'}>
                {line}
              </div>
            ))}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      );
    case 'check':
      return (
        <div
          className={`flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-meta font-medium ${step.ok ? 'bg-(--chip-done-bg) text-(--chip-done-fg)' : 'bg-danger-soft text-destructive'}`}
        >
          <span
            className={`flex size-4 items-center justify-center rounded-full ${step.ok ? 'bg-running-bar' : 'bg-destructive'} text-(--switch-thumb)`}
          >
            {step.ok ? <Check className="size-3" /> : <X className="size-3" />}
          </span>
          {step.label}
        </div>
      );
  }
}

export function TranscriptSteps({ steps }: { steps: { id: number; step: TranscriptStep }[] }) {
  return (
    <Trace className="gap-2.5">
      {steps.map(({ id, step }) => (
        <TranscriptLine key={id} step={step} />
      ))}
    </Trace>
  );
}

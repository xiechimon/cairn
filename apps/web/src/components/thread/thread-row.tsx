import { cn } from 'cn';
import { AlarmClockOff, GitPullRequest } from 'lucide-react';
import type { ReactNode } from 'react';
import { type StoneKind, StoneMark } from '../stone/stone-mark.js';
import type { StoneTone } from '../stone/tone.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';

const TONE_LABEL: Record<StoneTone, string> = {
  waiting: 'Waiting on you',
  review: 'Ready for review',
  working: 'Working',
  idle: 'Idle',
  resolved: 'Resolved',
};

export interface ThreadRowProps {
  title: string;
  reason: ReactNode;
  tone: StoneTone;
  kind: StoneKind;
  pr?: number;
  age?: string;
  snoozed?: boolean;
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  onOpen?: () => void;
  menu?: ReactNode;
}

export function ThreadRow({
  title,
  reason,
  tone,
  kind,
  pr,
  age,
  snoozed = false,
  selected = false,
  onSelectedChange,
  onOpen,
  menu,
}: ThreadRowProps) {
  const quietTitle = tone === 'idle' || tone === 'resolved';
  return (
    <div
      data-slot="thread-row"
      data-tone={tone}
      data-selected={selected ? '' : undefined}
      className={cn(
        'group/row relative flex items-start gap-2.5 rounded-(--radius-control) px-2.5 py-2.25 hover:bg-card hover:shadow-(--e1)',
        tone === 'waiting' && 'mb-1.5 bg-card shadow-(--e1)',
        selected && 'bg-card shadow-(--e1)',
      )}
    >
      {selected ? (
        <span aria-hidden="true" className="grid size-5.5 flex-none place-items-center">
          <Checkbox checked tabIndex={-1} onCheckedChange={() => onSelectedChange?.(false)} />
        </span>
      ) : (
        <StoneMark tone={tone} kind={kind} />
      )}
      <Button
        variant="ghost"
        onClick={onOpen}
        className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 p-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-ui',
              quietTitle ? 'font-medium text-content-secondary' : 'font-semibold text-foreground',
            )}
          >
            {title}
          </span>
          {pr != null && (
            <span className="inline-flex h-4.5 flex-none items-center gap-0.5 rounded-sm bg-(--chip-plan-bg) px-1.25 font-mono text-caption text-(--chip-plan-fg)">
              <GitPullRequest className="size-3" />#{pr}
            </span>
          )}
        </span>
        <span className="truncate text-meta text-content-secondary">{reason}</span>
        <span className="sr-only">{TONE_LABEL[tone]}</span>
      </Button>
      <span
        className={cn(
          'flex-none pt-0.5 font-mono text-caption text-content-tertiary',
          tone === 'working' && 'text-running-text',
          (selected || menu != null) && 'group-hover/row:invisible',
          selected && 'invisible',
        )}
      >
        {snoozed ? <AlarmClockOff className="size-3" aria-label="Snoozed" /> : age}
      </span>
      <span
        className={cn(
          'absolute top-1.5 right-1.5 hidden items-center gap-1 group-focus-within/row:flex group-hover/row:flex',
          selected && 'flex',
        )}
      >
        <Checkbox
          checked={selected}
          aria-label={`Select ${title}`}
          onCheckedChange={(next) => onSelectedChange?.(next)}
        />
        {menu}
      </span>
    </div>
  );
}

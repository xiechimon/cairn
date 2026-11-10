import { cn } from 'cn';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { ACCENT_INK } from '../../phase.js';
import { BrandGlyph } from '../brand-glyph.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';
import { PrLink } from './pr-link.js';

export type TaskRowGlyph = GlyphKind | 'question';

export interface TaskRowProps {
  title: string;
  glyph: TaskRowGlyph;
  word: string;
  what: string;
  where: string | null;
  age: string;
  waiting: boolean;
  running: boolean;
  muted?: boolean;
  prLink?: { number: number; url: string };
  check?: { label: string; onCheck: () => void } | 'none';
  menu?: ReactNode;
  onOpen?: () => void;
}

function Glyph({ glyph, waiting }: { glyph: TaskRowGlyph; waiting: boolean }) {
  const ink = waiting ? ACCENT_INK : 'text-content-tertiary';
  if (glyph === 'question') return <BrandGlyph className={cn('size-3.5 flex-none', ink)} />;
  return <StatusGlyph kind={glyph} className={ink} />;
}

export function TaskRow({
  title,
  glyph,
  word,
  what,
  where,
  age,
  waiting,
  running,
  muted = false,
  prLink,
  check,
  menu,
  onOpen,
}: TaskRowProps) {
  const linkRoom = prLink != null ? 'pr-16' : undefined;
  const row = (
    <Button
      variant="ghost"
      data-slot="task-row"
      data-waiting={waiting ? '' : undefined}
      onClick={onOpen}
      className={cn(
        'h-auto w-full items-start justify-start gap-2.5 rounded-(--radius-control) px-2.5 py-2 text-left font-normal whitespace-normal hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)',
        check !== undefined && 'pl-8',
        menu != null && 'pointer-coarse:pr-12',
      )}
    >
      <span className="mt-0.75 flex-none">
        <Glyph glyph={glyph} waiting={waiting} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-3">
          <span
            data-slot="task-row-title"
            className={cn(
              'line-clamp-2 min-w-0 flex-1 text-ui leading-5',
              muted ? 'text-content-secondary' : 'font-medium text-foreground',
            )}
          >
            {title}
          </span>
          <span
            className={cn(
              'flex flex-none items-center gap-1.5 text-meta leading-5 text-content-tertiary tabular-nums',
              menu != null &&
                'pointer-fine:group-hover/task:invisible pointer-fine:group-focus-within/task:invisible pointer-fine:group-has-aria-expanded/task:invisible',
            )}
          >
            {running && (
              <span
                aria-hidden
                data-slot="task-row-running"
                className="size-1.5 rounded-full bg-running"
              />
            )}
            {age}
          </span>
        </span>
        <span
          data-slot="task-row-what"
          className={cn('text-meta leading-5 text-content-secondary', where === null && linkRoom)}
        >
          <span className={waiting ? `${ACCENT_INK} font-medium` : 'text-content-tertiary'}>
            {word}
          </span>
          <span className="text-content-tertiary"> · </span>
          {what}
        </span>
        {where !== null && (
          <span
            data-slot="task-row-where"
            className={cn(
              'flex items-center gap-1 text-meta leading-5 font-medium text-foreground',
              linkRoom,
            )}
          >
            <ArrowRight aria-hidden className="size-3.5 text-content-tertiary" strokeWidth={1.75} />
            {where}
          </span>
        )}
      </span>
    </Button>
  );
  if (prLink == null && check === undefined && menu == null) return row;
  return (
    <div data-slot="task-row-frame" className="group/task relative">
      {row}
      {check !== undefined && check !== 'none' && (
        <Checkbox
          aria-label={check.label}
          checked={false}
          onCheckedChange={check.onCheck}
          className="absolute top-2.5 left-2.5"
        />
      )}
      {prLink != null && (
        <PrLink
          number={prLink.number}
          url={prLink.url}
          className={cn(
            'absolute right-2.5 bottom-2 text-meta leading-5',
            menu != null && 'pointer-coarse:right-12',
          )}
        />
      )}
      {menu != null && (
        <div
          data-slot="task-row-menu"
          className="absolute top-1.5 right-1.5 opacity-0 group-focus-within/task:opacity-100 group-hover/task:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:opacity-100"
        >
          {menu}
        </div>
      )}
    </div>
  );
}

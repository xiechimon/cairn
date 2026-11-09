import { cn } from 'cn';
import { ArrowRight } from 'lucide-react';
import { ACCENT_INK } from '../../phase.js';
import { BrandGlyph } from '../brand-glyph.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { Button } from '../ui/button.js';

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
  onOpen,
}: TaskRowProps) {
  return (
    <Button
      variant="ghost"
      data-slot="task-row"
      data-waiting={waiting ? '' : undefined}
      onClick={onOpen}
      className="h-auto w-full items-start justify-start gap-2.5 rounded-(--radius-control) px-2.5 py-2 text-left font-normal whitespace-normal hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)"
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
          <span className="flex flex-none items-center gap-1.5 text-meta leading-5 text-content-tertiary tabular-nums">
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
        <span data-slot="task-row-what" className="text-meta leading-5 text-content-secondary">
          <span className={waiting ? `${ACCENT_INK} font-medium` : 'text-content-tertiary'}>
            {word}
          </span>
          <span className="text-content-tertiary"> · </span>
          {what}
        </span>
        {where !== null && (
          <span
            data-slot="task-row-where"
            className="flex items-center gap-1 text-meta leading-5 font-medium text-foreground"
          >
            <ArrowRight aria-hidden className="size-3.5 text-content-tertiary" strokeWidth={1.75} />
            {where}
          </span>
        )}
      </span>
    </Button>
  );
}

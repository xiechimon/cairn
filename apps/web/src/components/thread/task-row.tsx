import { cn } from 'cn';
import { type ReactNode, useId } from 'react';
import { BrandGlyph } from '../brand-glyph.js';
import { IconTooltip } from '../icon-tooltip.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { PrLink } from './pr-link.js';

export type TaskRowGlyph = GlyphKind | 'question';

export interface TaskRowProps {
  title: string;
  glyph: TaskRowGlyph;
  word: string;
  what: string;
  where: string | null;
  age: string;
  date?: string;
  waiting: boolean;
  muted?: boolean;
  prLink?: { number: number; url: string };
  check?: { label: string; onCheck: () => void } | 'none';
  why?: string;
  menu?: ReactNode;
  onOpen?: () => void;
}

const ROW_DESCRIPTION_DELAY = 600;

const LEAD_BOX = 'flex size-7 flex-none items-center justify-center';

function Glyph({ glyph }: { glyph: TaskRowGlyph }) {
  if (glyph === 'question')
    return <BrandGlyph className="size-4 flex-none text-content-tertiary" />;
  return <StatusGlyph kind={glyph} className="text-content-tertiary" />;
}

export function TaskRow({
  title,
  glyph,
  word,
  what,
  where,
  age,
  date,
  waiting,
  muted = false,
  prLink,
  check,
  why,
  menu,
  onOpen,
}: TaskRowProps) {
  const descriptionId = useId();
  const checkable = check !== undefined && check !== 'none';
  const status = `${word} · ${what}${waiting && where !== null ? ` → ${where}` : ''}${age === '' ? '' : ` · ${age}`}`;
  const dated = date !== undefined && date !== '';
  const row = (
    <Tooltip>
      <TooltipTrigger
        delay={ROW_DESCRIPTION_DELAY}
        render={
          <Button
            variant="ghost"
            data-slot="task-row"
            data-waiting={waiting ? '' : undefined}
            aria-describedby={descriptionId}
            onClick={onOpen}
            className={cn(
              'h-auto w-full items-start justify-start gap-4 rounded-(--radius-tile) px-2.5 py-2 text-left font-normal whitespace-normal hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)',
              menu != null && 'pointer-coarse:pr-12',
              prLink != null && 'pr-16',
            )}
          />
        }
      >
        <span data-slot="task-row-lead" className={LEAD_BOX}>
          {!checkable && why === undefined && <Glyph glyph={glyph} />}
        </span>
        <span className="flex min-h-7 min-w-0 flex-1 flex-col justify-center">
          <span className="flex min-w-0 items-center gap-3">
            <span
              data-slot="task-row-title"
              className={cn(
                'min-w-0 flex-1 truncate text-ui leading-5',
                muted ? 'text-content-secondary' : 'text-foreground',
              )}
            >
              {title}
            </span>
            {dated && (
              <span
                className={cn(
                  'flex-none text-caption leading-5 text-content-tertiary tabular-nums',
                  menu != null &&
                    'pointer-fine:group-hover/task:invisible pointer-fine:group-focus-within/task:invisible pointer-fine:group-has-aria-expanded/task:invisible',
                )}
              >
                {date}
              </span>
            )}
          </span>
          {waiting && (
            <span
              data-slot="task-row-what"
              className="min-w-0 truncate text-meta leading-4.5 text-content-tertiary"
            >
              {what}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8} data-slot="task-row-tooltip">
        {status}
      </TooltipContent>
    </Tooltip>
  );
  return (
    <div data-slot="task-row-frame" className="group/task relative">
      {row}
      <span id={descriptionId} data-slot="task-row-description" className="sr-only">
        {`${word} · ${what}`}
        {waiting && where !== null && <span data-slot="task-row-where">{` → ${where}`}</span>}
        {age !== '' && ` · ${age}`}
      </span>
      {checkable && (
        <Checkbox
          aria-label={check.label}
          checked={false}
          onCheckedChange={check.onCheck}
          data-waiting={waiting ? '' : undefined}
          className="absolute top-3.5 left-4 data-waiting:border-(--card-button)"
        />
      )}
      {!checkable && why !== undefined && (
        <IconTooltip
          label={why}
          trigger={
            <Button
              variant="ghost"
              tabIndex={-1}
              data-slot="task-row-why"
              onClick={onOpen}
              className={cn(
                LEAD_BOX,
                'absolute top-2 left-2.5 rounded-(--radius-control) p-0 hover:bg-transparent dark:hover:bg-transparent',
              )}
            />
          }
        >
          <Glyph glyph={glyph} />
        </IconTooltip>
      )}
      {prLink != null && (
        <PrLink
          number={prLink.number}
          url={prLink.url}
          className={cn(
            'absolute top-3 right-2.5 text-caption leading-5',
            menu != null &&
              'pointer-coarse:right-12 pointer-fine:group-hover/task:right-10 pointer-fine:group-focus-within/task:right-10',
          )}
        />
      )}
      {menu != null && (
        <div
          data-slot="task-row-menu"
          className="absolute top-3 right-2 opacity-0 group-focus-within/task:opacity-100 group-hover/task:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:top-0.5 pointer-coarse:right-0 pointer-coarse:opacity-100"
        >
          {menu}
        </div>
      )}
    </div>
  );
}

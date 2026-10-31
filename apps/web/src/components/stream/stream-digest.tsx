import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import type { StoneTone } from '../stone/tone.js';
import { ToneGlyph } from '../stone/tone-glyph.js';
import { Button } from '../ui/button.js';

export interface DigestRow {
  tone: Extract<StoneTone, 'waiting' | 'working' | 'resolved'>;
  count: number;
  label: string;
  onSelect?: () => void;
}

const ROW =
  'flex h-8.5 w-full items-center gap-2 rounded-lg px-2.5 text-left text-ui text-content-secondary';

export function StreamDigest({ rows, className }: { rows: DigestRow[]; className?: string }) {
  const visible = rows.filter((row) => row.count > 0);
  if (visible.length === 0) return null;
  return (
    <ul
      data-slot="stream-digest"
      className={cn('m-0 flex list-none flex-col gap-0.5 p-0', className)}
    >
      {visible.map((row) => {
        const body = (
          <>
            <ToneGlyph tone={row.tone} />
            <b className="w-4.5 font-semibold text-foreground tabular-nums">{row.count}</b>
            <span>{row.label}</span>
            {row.onSelect != null && (
              <ChevronRight className="ml-auto size-3.5 text-content-tertiary" />
            )}
          </>
        );
        return (
          <li key={row.tone}>
            {row.onSelect != null ? (
              <Button
                variant="ghost"
                onClick={row.onSelect}
                className={cn(
                  ROW,
                  'justify-start font-normal hover:bg-menu-hover dark:hover:bg-menu-hover',
                )}
              >
                {body}
              </Button>
            ) : (
              <div className={ROW}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

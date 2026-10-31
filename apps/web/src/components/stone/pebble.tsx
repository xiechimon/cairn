import { cn } from 'cn';
import { PEBBLE_BG, type StoneTone } from './tone.js';

export function Pebble({ tone, className }: { tone: StoneTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn(
        'inline-block h-1.75 w-2 flex-none rounded-[55%_45%_52%_48%]',
        PEBBLE_BG[tone],
        className,
      )}
    />
  );
}

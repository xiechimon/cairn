import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';
import type { StoneTone } from './tone.js';
import { ToneGlyph } from './tone-glyph.js';

export function StoneTrail({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-1 p-1.5', className)}>{children}</div>;
}

export interface StoneGroupProps {
  tone: StoneTone;
  label: string;
  count: number;
  collapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
  emptyHint?: string;
  children?: ReactNode;
}

export function StoneGroup({
  tone,
  label,
  count,
  collapsed = false,
  onCollapsedChange,
  emptyHint,
  children,
}: StoneGroupProps) {
  return (
    <section data-slot="stone-group" data-tone={tone} className="relative">
      <Button
        variant="ghost"
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange?.(!collapsed)}
        className="h-8 w-full justify-start gap-2.5 px-2.5 text-meta font-medium text-content-secondary hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent dark:hover:bg-transparent"
      >
        <ToneGlyph tone={tone} />
        {label}
        <span className="font-normal text-content-tertiary tabular-nums">{count}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 text-content-tertiary transition-transform duration-(--dur-fast)',
            collapsed && '-rotate-90',
          )}
        />
      </Button>
      {!collapsed &&
        (count === 0 && emptyHint != null ? (
          <p className="m-0 pt-0.5 pb-2 pl-8.5 text-meta text-content-tertiary">{emptyHint}</p>
        ) : (
          <div className="flex flex-col">{children}</div>
        ))}
    </section>
  );
}

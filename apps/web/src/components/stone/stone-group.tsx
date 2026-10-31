import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';
import { PEBBLE_BG, type StoneTone } from './tone.js';

const BIG_PEBBLE: Record<StoneTone, string> = {
  ...PEBBLE_BG,
  idle: 'bg-canvas shadow-[inset_0_0_0_1.5px_var(--text-tertiary)]',
  resolved: 'bg-canvas shadow-[inset_0_0_0_1.5px_var(--text-tertiary)]',
};

export function StoneTrail({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1.5 py-1 pr-2 pb-6 pl-3.5 before:pointer-events-none before:absolute before:top-3 before:bottom-7.5 before:left-7.5 before:border-l-[1.5px] before:border-dashed before:border-border before:content-['']",
        className,
      )}
    >
      {children}
    </div>
  );
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
        className="relative h-8.5 w-full justify-start gap-2 pr-2.5 pl-7 text-meta font-semibold text-content-secondary hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent dark:hover:bg-transparent"
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-2.75 left-2.5 h-2.75 w-3.25 rounded-[52%_48%_45%_55%/55%_50%_50%_45%]',
            BIG_PEBBLE[tone],
          )}
        />
        {label}
        <span className="font-mono text-caption font-medium text-content-tertiary">{count}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 text-content-tertiary transition-transform duration-(--dur-fast)',
            collapsed && '-rotate-90',
          )}
        />
      </Button>
      {!collapsed &&
        (count === 0 && emptyHint != null ? (
          <p className="mt-0.5 mb-1.5 ml-5.5 rounded-xl border border-dashed border-border p-3 text-center text-meta text-content-tertiary">
            {emptyHint}
          </p>
        ) : (
          <div className="flex flex-col pl-5.5">{children}</div>
        ))}
    </section>
  );
}

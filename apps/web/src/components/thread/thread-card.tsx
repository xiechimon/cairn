import { cn } from 'cn';
import type { ReactNode } from 'react';
import type { StoneTone } from '../stone/tone.js';
import { ToneGlyph } from '../stone/tone-glyph.js';
import { Button } from '../ui/button.js';

export interface ThreadCardProps {
  title: string;
  tone: StoneTone;
  stateLabel: string;
  reason: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  viewLabel?: string;
  onView?: () => void;
  className?: string;
}

export function ThreadCard({
  title,
  tone,
  stateLabel,
  reason,
  primaryLabel,
  onPrimary,
  viewLabel = 'View thread',
  onView,
  className,
}: ThreadCardProps) {
  return (
    <article
      data-slot="thread-card"
      data-tone={tone}
      className={cn(
        'flex gap-3 rounded-(--radius-card) bg-card px-4 py-3.5 shadow-(--e1)',
        className,
      )}
    >
      <ToneGlyph tone={tone} className="mt-0.75" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <h3 className="m-0 min-w-0 truncate text-ui font-semibold text-foreground">{title}</h3>
          <span className="sr-only">{stateLabel}</span>
        </div>
        <p className="mt-0.5 mb-0 text-meta text-content-secondary">{reason}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {primaryLabel != null && (
            <Button size="sm" onClick={onPrimary} className="h-6.5 px-2.25 text-meta">
              {primaryLabel}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onView}
            className="h-6.5 px-2.25 text-meta text-content-secondary"
          >
            {viewLabel}
          </Button>
        </div>
      </div>
    </article>
  );
}

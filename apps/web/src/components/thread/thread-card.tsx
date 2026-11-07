import { cn } from 'cn';
import type { ReactNode } from 'react';
import type { StoneTone } from '../stone/tone.js';
import { ToneGlyph } from '../stone/tone-glyph.js';
import { Button } from '../ui/button.js';
import { PrLink } from './pr-link.js';

export interface ThreadCardProps {
  title: string;
  tone: StoneTone;
  stateLabel: string;
  reason: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  viewLabel?: string;
  onView?: () => void;
  footer?: ReactNode;
  prLink?: { number: number; url: string };
  compact?: boolean;
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
  footer,
  prLink,
  compact = false,
  className,
}: ThreadCardProps) {
  if (compact) {
    return (
      <article
        data-slot="thread-card"
        data-tone={tone}
        className={cn(
          '@container flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-(--radius-card) bg-card px-3 py-1.5 shadow-(--e1)',
          className,
        )}
      >
        <ToneGlyph tone={tone} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="m-0 min-w-0 truncate text-ui font-semibold text-foreground @lg:max-w-[55%] @lg:flex-none">
            {title}
          </h3>
          <span className="sr-only">{stateLabel}</span>
          {prLink != null && (
            <PrLink number={prLink.number} url={prLink.url} className="flex-none text-meta" />
          )}
          <p className="m-0 min-w-0 flex-1 truncate text-meta text-content-secondary @max-lg:sr-only">
            {reason}
          </p>
        </div>
        <div className="flex flex-none gap-1.5">
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
        {footer != null && <div className="basis-full pb-1">{footer}</div>}
      </article>
    );
  }
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
          {prLink != null && (
            <PrLink number={prLink.number} url={prLink.url} className="text-meta" />
          )}
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
        {footer != null && <div className="mt-3">{footer}</div>}
      </div>
    </article>
  );
}

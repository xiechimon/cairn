import { cn } from 'cn';
import { Check, Clock } from 'lucide-react';
import { Button } from '../ui/button.js';

export interface ProposalCardProps {
  status: 'proposed' | 'applied';
  title: string;
  description: string;
  meta: string;
  appliedTitle: string;
  openLabel: string;
  onApply?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  onOpen?: () => void;
  className?: string;
}

export function ProposalCard({
  status,
  title,
  description,
  meta,
  appliedTitle,
  openLabel,
  onApply,
  onEdit,
  onDismiss,
  onOpen,
  className,
}: ProposalCardProps) {
  const applied = status === 'applied';
  const Icon = applied ? Check : Clock;
  return (
    <div
      data-slot="proposal-card"
      data-status={status}
      className={cn(
        'rounded-(--radius-card) border px-4 py-3.5',
        applied ? 'border-border bg-card' : 'border-dashed border-content-tertiary',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-ui font-semibold text-foreground">
        <Icon className="size-4 flex-none text-(--chip-plan-fg)" />
        {applied ? appliedTitle : title}
      </div>
      {!applied && <p className="mt-1.5 mb-0 text-ui text-content-secondary">{description}</p>}
      <p className="mt-1.5 mb-0 font-mono text-caption text-content-tertiary">{meta}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {applied ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onOpen}
            className="h-6.5 px-2.25 text-meta text-content-secondary"
          >
            {openLabel}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onApply} className="h-6.5 px-2.25 text-meta">
              Update setup
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="h-6.5 px-2.25 text-meta text-content-secondary"
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="h-6.5 px-2.25 text-meta text-content-secondary"
            >
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

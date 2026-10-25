import { cn } from 'cn';
import type { ComponentType, SVGProps } from 'react';
import { Button } from './ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from './ui/dialog-shell.js';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from './ui/empty.js';

type EmptyStateIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface EmptyStateProps {
  icon: EmptyStateIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; disabled?: boolean };
  hint?: { icon?: EmptyStateIcon; text: string };
  className?: string;
  testId?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  hint,
  className,
  testId,
}: EmptyStateProps) {
  const HintIcon = hint?.icon;
  return (
    <Empty data-testid={testId} className={cn('empty-state', className)}>
      <EmptyHeader className="gap-1">
        <EmptyMedia className="mb-3 text-content-tertiary">
          <Icon className="size-6" strokeWidth={1.75} />
        </EmptyMedia>
        <h2 className="m-0 text-card-title font-medium text-balance text-foreground">{title}</h2>
        {description != null && (
          <p className="m-0 max-w-80 text-meta text-balance text-content-tertiary">{description}</p>
        )}
      </EmptyHeader>
      {(action != null || hint != null) && (
        <EmptyContent className="gap-2">
          {action != null && (
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {hint != null && (
            <p className="m-0 flex items-center gap-1 text-meta text-content-tertiary">
              {HintIcon != null && (
                <HintIcon className="size-3 text-content-dim" strokeWidth={1.75} />
              )}
              {hint.text}
            </p>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}

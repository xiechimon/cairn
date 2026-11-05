import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Badge } from '../components/ui/badge.js';

export function NotBuilt({ children = 'Not built yet' }: { children?: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className="border-dashed font-normal text-content-tertiary"
      data-slot="not-built"
    >
      {children}
    </Badge>
  );
}

export function Shot({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-shot={id} className={cn('flex min-w-0 flex-none flex-col gap-3', className)}>
      {children}
    </div>
  );
}

export function OptionTitle({ option, title }: { option: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-secondary text-meta font-semibold text-foreground">
        {option}
      </span>
      <span className="text-card-title font-semibold text-foreground">{title}</span>
    </div>
  );
}

export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative flex flex-none flex-col overflow-hidden rounded-3xl bg-background shadow-(--e1) ring-1 ring-border',
        className,
      )}
      style={{ width: 390, height: 780 }}
    >
      {children}
    </div>
  );
}

export function DraftNote({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-160 text-meta text-content-tertiary">{children}</p>;
}

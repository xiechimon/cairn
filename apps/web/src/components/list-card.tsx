import { cn } from 'cn';
import type { ReactNode } from 'react';

export function ListCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      data-slot="list-card"
      className={cn(
        'flex flex-col divide-y divide-border overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function ListRow({ icon, title, subtitle, trailing, className }: ListRowProps) {
  return (
    <div
      data-slot="list-row"
      className={cn(
        'flex items-center gap-3 px-3.5 py-3 text-ui hover:bg-sidebar-hover',
        className,
      )}
    >
      {icon != null && <span className="flex-none text-content-secondary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{title}</span>
        {subtitle != null && (
          <small className="block truncate text-meta text-content-tertiary">{subtitle}</small>
        )}
      </div>
      {trailing != null && (
        <span className="flex-none text-meta whitespace-nowrap text-content-tertiary">
          {trailing}
        </span>
      )}
    </div>
  );
}

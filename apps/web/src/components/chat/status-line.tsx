import { cn } from 'cn';
import type { ReactNode } from 'react';

export const STATUS_LINE_CLS =
  'chat-note flex min-h-6 min-w-0 items-center gap-2 text-left font-sans text-meta text-(--text-tertiary)';

export const STATUS_REF_CLS =
  'cursor-pointer text-inherit underline decoration-current/40 underline-offset-3 hover:text-(--foreground)';

export function StatusLine({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn(STATUS_LINE_CLS, className)} data-testid={testId}>
      <span className="max-w-[68ch] min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

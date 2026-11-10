import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function UserMessageBubble({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'min-w-0 bubble-gradient rounded-(--cds-radius-xl) px-3 py-2 text-card-title text-(--foreground)',
        className,
      )}
      {...props}
    />
  );
}

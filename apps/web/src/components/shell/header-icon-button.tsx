import { cn } from 'cn';
import type * as React from 'react';
import { Button } from '../ui/button.js';

export function HeaderIconButton({
  attention = false,
  active = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> & {
  attention?: boolean;
  active?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      data-slot="header-icon-button"
      aria-pressed={active}
      className={cn(
        'relative size-7.5 text-content-tertiary hover:text-foreground',
        active && 'bg-muted text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {attention && (
        <span
          aria-hidden="true"
          data-attention=""
          className="absolute top-1.25 right-1.25 size-1.75 rounded-full bg-pebble-waiting ring-2 ring-background"
        />
      )}
    </Button>
  );
}

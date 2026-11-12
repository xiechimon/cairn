import { cn } from 'cn';
import type * as React from 'react';
import { Button } from '../ui/button.js';

export function SuggestionChip({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button
      variant="ghost"
      data-slot="suggestion-chip"
      className={cn(
        'h-7 rounded-lg px-2.5 text-ui font-normal text-foreground hover:bg-menu-hover dark:hover:bg-menu-hover',
        className,
      )}
      {...props}
    />
  );
}

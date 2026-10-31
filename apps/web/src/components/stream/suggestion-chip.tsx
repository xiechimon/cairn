import { cn } from 'cn';
import type * as React from 'react';
import { Button } from '../ui/button.js';

export function SuggestionChip({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button
      variant="outline"
      data-slot="suggestion-chip"
      className={cn(
        'h-7.5 rounded-full bg-card px-3 text-ui font-normal text-content-secondary hover:text-foreground dark:bg-card dark:hover:bg-card',
        className,
      )}
      {...props}
    />
  );
}

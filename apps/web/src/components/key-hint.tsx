import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function KeyHint({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="key-hint"
      className={cn('text-right text-caption tabular-nums text-content-tertiary', className)}
      {...props}
    />
  );
}

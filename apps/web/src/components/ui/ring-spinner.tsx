import { cn } from 'cn';
import type * as React from 'react';

function RingSpinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className={cn('spin-ring', className)}
      {...props}
    >
      <circle cx="12" cy="12" r="10" strokeWidth="2.5" opacity="0.2" />
      <circle
        cx="12"
        cy="12"
        r="10"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="16 46.8"
      />
    </svg>
  );
}

export { RingSpinner };

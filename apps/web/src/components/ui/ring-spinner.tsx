import { cn } from 'cn';
import type * as React from 'react';
import { useI18n } from '../../i18n/provider.js';

function RingSpinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const { t } = useI18n();
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label={t('加载中…')}
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

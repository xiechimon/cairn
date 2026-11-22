import { cn } from 'cn';
import { Loader2Icon } from 'lucide-react';
import type * as React from 'react';
import { useI18n } from '../../i18n/provider.js';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const { t } = useI18n();
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t('加载中…')}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };

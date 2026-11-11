'use client';

import { Info, LoaderCircle, OctagonX, TriangleAlert, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps, toast } from 'sonner';
import { useI18n } from '../../i18n/provider.js';

export function toastError(title: string, error: unknown): void {
  const reason = error instanceof Error && error.message !== '' ? error.message : null;
  toast.error(title, reason !== null ? { description: reason } : undefined);
}

export function toastSuccess(title: string, action?: { label: string; onClick: () => void }): void {
  toast.success(title, action ? { action } : undefined);
}

function useSonnerTheme(): ToasterProps['theme'] {
  const [theme, setTheme] = useState<ToasterProps['theme']>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('light')
      ? 'light'
      : 'dark',
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function Toaster({ ...props }: ToasterProps) {
  const theme = useSonnerTheme();
  const { t } = useI18n();
  return (
    <Sonner
      theme={theme}
      closeButton
      position="top-center"
      offset={{ top: 16 }}
      mobileOffset={{ top: 66, left: 16, right: 16 }}
      className="group"
      icons={{
        success: <Info className="size-5" />,
        info: <Info className="size-5" />,
        warning: <TriangleAlert className="size-5 text-(--badge-attention)" />,
        error: <OctagonX className="size-5 text-destructive" />,
        loading: <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />,
        close: <X className="size-5" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-popover)',
        } as CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: t('关闭'),
        classNames: {
          toast: 'grid! grid-cols-[auto_1fr_auto]! items-center! gap-x-2! gap-y-2!',
          icon: 'col-start-1 row-start-1 m-0!',
          content: 'col-start-2 row-start-1',
          title: 'text-ui font-normal!',
          description: 'text-meta text-content-secondary',
          actionButton:
            'col-start-2 row-start-2 ms-0! h-7! justify-self-start rounded-lg! bg-secondary! px-2.5! text-ui! font-normal! text-foreground! hover:bg-muted!',
          closeButton:
            'static! col-start-3 row-start-1 size-7! transform-none! rounded-lg! border-0! bg-transparent! text-foreground! hover:bg-muted!',
        },
      }}
      {...props}
    />
  );
}

export { Toaster, useSonnerTheme };

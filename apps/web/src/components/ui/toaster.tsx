'use client';

import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps, toast } from 'sonner';

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
  return (
    <Sonner
      theme={theme}
      position="bottom-left"
      className="group"
      icons={{
        success: <CircleCheck className="size-4 text-running-text" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4 text-(--badge-attention)" />,
        error: <OctagonX className="size-4 text-destructive" />,
        loading: <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-popover)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, useSonnerTheme };

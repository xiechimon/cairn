'use client';

import { Info, OctagonX, TriangleAlert, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type ExternalToast,
  Toaster as Sonner,
  toast as sonnerToast,
  type ToasterProps,
} from 'sonner';
import { useI18n } from '../../i18n/provider.js';
import { describeErrorForToast } from '../../lib/error-copy.js';
import { markErrorSurfaced } from '../../lib/mutation-error-report.js';
import { RingSpinner } from './ring-spinner.js';

type ToastTitle = Parameters<typeof sonnerToast>[0];
type ToastKind = 'message' | 'error' | 'success' | 'info' | 'warning';

function collapsing(
  kind: ToastKind,
  title: ToastTitle,
  data?: ExternalToast,
): ExternalToast | undefined {
  if (typeof title !== 'string') return data;
  if (data?.id !== undefined || data?.action !== undefined || data?.cancel !== undefined)
    return data;
  const description = typeof data?.description === 'string' ? data.description : '';
  return { ...data, id: JSON.stringify([kind, title, description]) };
}

export const toast = Object.assign(
  (title: ToastTitle, data?: ExternalToast) =>
    sonnerToast(title, collapsing('message', title, data)),
  {
    error: (title: ToastTitle, data?: ExternalToast) =>
      sonnerToast.error(title, collapsing('error', title, data)),
    success: (title: ToastTitle, data?: ExternalToast) =>
      sonnerToast.success(title, collapsing('success', title, data)),
    info: (title: ToastTitle, data?: ExternalToast) =>
      sonnerToast.info(title, collapsing('info', title, data)),
    warning: (title: ToastTitle, data?: ExternalToast) =>
      sonnerToast.warning(title, collapsing('warning', title, data)),
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  },
);

export function toastError(title: string, error: unknown): void {
  markErrorSurfaced(error);
  const reason = describeErrorForToast(error);
  toast.error(title, reason !== null && reason !== title ? { description: reason } : undefined);
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
  const closeLabel = t('关闭');
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const stampTitles = () => {
      for (const button of root.querySelectorAll<HTMLButtonElement>(
        '[data-sonner-toast] [data-close-button]',
      )) {
        if (button.getAttribute('title') !== closeLabel) button.setAttribute('title', closeLabel);
      }
    };
    stampTitles();
    const observer = new MutationObserver(stampTitles);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [closeLabel]);
  return (
    <div ref={rootRef} className="contents">
      <Sonner
        theme={theme}
        closeButton
        containerAriaLabel={t('通知')}
        position="top-center"
        offset={{ top: 16 }}
        mobileOffset={{ top: 66, left: 16, right: 16 }}
        className="group"
        icons={{
          success: <Info className="size-5 text-content-secondary" />,
          info: <Info className="size-5 text-content-secondary" />,
          warning: <TriangleAlert className="size-5 text-(--badge-attention)" />,
          error: <OctagonX className="size-5 text-destructive" />,
          loading: <RingSpinner className="size-5" />,
          close: <X className="size-4" />,
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
          closeButtonAriaLabel: closeLabel,
          classNames: {
            toast:
              'grid! grid-cols-[auto_1fr_auto]! items-center! gap-x-2.5! gap-y-2! border-0! p-4! font-sans! shadow-(--shadow-popover)!',
            icon: 'col-start-1 row-start-1 m-0!',
            content: 'col-start-2 row-start-1',
            title: 'text-ui font-medium! text-foreground!',
            description: 'text-meta text-content-secondary',
            actionButton:
              'col-start-2 row-start-2 ms-0! h-7! justify-self-start rounded-lg! bg-secondary! px-2.5! text-ui! font-medium! text-foreground! hover:bg-muted!',
            closeButton:
              'static! col-start-3 row-start-1 size-7! transform-none! rounded-lg! border-0! bg-transparent! text-foreground! hover:bg-muted!',
          },
        }}
        {...props}
      />
    </div>
  );
}

export { Toaster, useSonnerTheme };

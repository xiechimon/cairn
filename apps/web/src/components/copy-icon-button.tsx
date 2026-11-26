import { cn } from 'cn';
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { copyTextWithFeedback } from '../lib/clipboard.js';
import { IconTooltip } from './icon-tooltip.js';
import { Button } from './ui/button.js';
import { toastError, toastSuccess } from './ui/toaster.js';

const COPIED_MS = 1500;

export function useCopyWithToast(): (text: string) => void {
  const { t } = useI18n();
  return useCallback(
    (text: string) =>
      copyTextWithFeedback(
        text,
        () => toastSuccess(t('已复制')),
        (error) => toastError(t('复制失败，请重试。'), error),
      ),
    [t],
  );
}

export function useCopiedFlash(): { copied: boolean; copy: (text: string) => void } {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = useCallback(
    (text: string) =>
      copyTextWithFeedback(
        text,
        () => setCopied(true),
        (error) => toastError(t('未能复制，请重试'), error),
      ),
    [t],
  );
  return { copied, copy };
}

const COPY_ICON_BUTTON_CLS =
  'size-8 flex-none cursor-pointer rounded-(--radius-control) text-foreground transition-none hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

export function CopyIconButton({
  text,
  label,
  copiedLabel,
  testId,
  className,
  replaceClassName = false,
  size = 'icon',
  side,
  disabled = false,
  icons,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  testId: string;
  className?: string;
  replaceClassName?: boolean;
  size?: 'icon' | 'icon-sm';
  side?: 'top' | 'bottom';
  disabled?: boolean;
  icons?: { copy: ReactNode; copied: ReactNode };
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopiedFlash();
  return (
    <IconTooltip
      label={
        copied ? (copiedLabel ?? (label === undefined ? t('已复制') : label)) : (label ?? t('复制'))
      }
      side={side}
      trigger={
        <Button
          variant="ghost"
          size={size}
          className={replaceClassName ? className : cn(COPY_ICON_BUTTON_CLS, className)}
          data-testid={testId}
          data-copied={copied ? '' : undefined}
          disabled={disabled}
          onClick={() => copy(text)}
        />
      }
    >
      <span className="relative inline-grid place-items-center" aria-hidden="true">
        <span
          data-slot="copy-icon"
          className={cn(
            'col-start-1 row-start-1 grid place-items-center transition-[opacity,scale] duration-(--dur-fast) ease-(--ease-out-strong) motion-reduce:transition-none',
            copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
          )}
        >
          {icons?.copy ?? <Copy className="size-4" />}
        </span>
        <span
          data-slot="check-icon"
          className={cn(
            'check-scale col-start-1 row-start-1 grid place-items-center',
            copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
          )}
        >
          {icons?.copied ?? <Check className="size-4" />}
        </span>
      </span>
    </IconTooltip>
  );
}

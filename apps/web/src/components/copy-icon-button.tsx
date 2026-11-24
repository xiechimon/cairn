import { cn } from 'cn';
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { copyTextWithFeedback } from '../lib/clipboard.js';
import { IconTooltip } from './icon-tooltip.js';
import { Button } from './ui/button.js';
import { toastError } from './ui/toaster.js';

const COPIED_MS = 1500;

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
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    copyTextWithFeedback(
      text,
      () => setCopied(true),
      (error) => toastError(t('未能复制，请重试'), error),
    );
  };
  return (
    <IconTooltip
      label={copied && copiedLabel !== undefined ? copiedLabel : (label ?? t('复制'))}
      side={side}
      trigger={
        <Button
          variant="ghost"
          size={size}
          className={replaceClassName ? className : cn(COPY_ICON_BUTTON_CLS, className)}
          data-testid={testId}
          data-copied={copied ? '' : undefined}
          disabled={disabled}
          onClick={copy}
        />
      }
    >
      {copied
        ? (icons?.copied ?? <Check className="size-4" />)
        : (icons?.copy ?? <Copy className="size-4" />)}
    </IconTooltip>
  );
}

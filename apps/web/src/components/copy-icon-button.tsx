import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { Check, Copy } from '../icons/index.js';
import { IconTooltip } from './icon-tooltip.js';
import { Button } from './ui/button.js';
import { toastError } from './ui/toaster.js';

const COPIED_MS = 1500;

const COPY_ICON_BUTTON_CLS =
  'size-8 flex-none cursor-pointer rounded-(--radius-control) text-foreground transition-none hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

export function CopyIconButton({
  text,
  label,
  testId,
  className,
}: {
  text: string;
  label?: string;
  testId: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    const failed = (error: unknown) => toastError(t('未能复制，请重试'), error);
    const clip = navigator.clipboard;
    if (clip === undefined) {
      failed(null);
      return;
    }
    void clip.writeText(text).then(() => setCopied(true), failed);
  };
  return (
    <IconTooltip
      label={label ?? t('复制')}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className={cn(COPY_ICON_BUTTON_CLS, className)}
          data-testid={testId}
          data-copied={copied ? '' : undefined}
          onClick={copy}
        />
      }
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </IconTooltip>
  );
}

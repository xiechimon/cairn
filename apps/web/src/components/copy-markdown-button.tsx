import { cn } from 'cn';
import { useI18n } from '../i18n/provider.js';
import { Copy } from '../icons/index.js';
import { Button } from './ui/button.js';
import { toastError, toastSuccess } from './ui/toaster.js';

export function CopyMarkdownButton({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const { t } = useI18n();
  const copy = () => {
    void navigator.clipboard.writeText(markdown).then(
      () => toastSuccess(t('已复制为 Markdown')),
      (error: unknown) => toastError(t('没能复制，再试一次'), error),
    );
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="copy-markdown"
      onClick={copy}
      className={cn(
        'gap-1.5 text-meta font-normal text-content-secondary hover:text-foreground pointer-coarse:h-11',
        className,
      )}
    >
      <Copy aria-hidden="true" strokeWidth={1.75} className="size-4" />
      {t('复制为 Markdown')}
    </Button>
  );
}

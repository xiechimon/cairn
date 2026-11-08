import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';

const QUOTE_CLS =
  'm-0 min-w-0 flex-1 border-l-2 border-border pl-3 text-meta leading-5 whitespace-pre-wrap text-content-secondary line-clamp-3';
const REMOVE_CLS =
  "size-6 flex-none cursor-pointer rounded-(--radius-control) text-content-tertiary transition-none hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto";

export function ReplyQuoteBlock({ quote, onRemove }: { quote: string; onRemove?: () => void }) {
  const { t } = useI18n();
  return (
    <div
      data-testid={onRemove === undefined ? 'reply-quote' : 'composer-reply-quote'}
      className={onRemove === undefined ? 'mb-2 flex' : 'mb-2 flex items-start gap-2'}
    >
      <blockquote className={QUOTE_CLS}>{quote}</blockquote>
      {onRemove !== undefined && (
        <IconTooltip
          label={t('移除引用')}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('移除引用')}
              data-testid="composer-reply-quote-remove"
              className={REMOVE_CLS}
              onClick={onRemove}
            />
          }
        >
          <X width={14} height={14} />
        </IconTooltip>
      )}
    </div>
  );
}

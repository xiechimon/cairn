import { Reply } from 'lucide-react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';

const QUOTE_CLS =
  'm-0 flex min-w-0 flex-1 border-l-2 border-border pl-3 text-meta leading-5 whitespace-pre-wrap text-content-secondary line-clamp-3';
const REMOVE_CLS =
  "size-7 flex-none cursor-pointer rounded-(--radius-control) text-content-tertiary transition-none hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto";

export function ReplyQuoteBlock({ quote, sourceHref }: { quote: string; sourceHref?: string }) {
  return (
    <div data-testid="reply-quote" className="mb-2 flex">
      <blockquote className={QUOTE_CLS}>
        {sourceHref === undefined ? (
          quote
        ) : (
          <a
            href={sourceHref}
            className="text-inherit no-underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {quote}
          </a>
        )}
      </blockquote>
    </div>
  );
}

function firstLine(quote: string): string {
  return (
    quote
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  );
}

export function ReplyingToBar({
  quote,
  onRemove,
  onHighlight,
}: {
  quote: string;
  onRemove: () => void;
  onHighlight: (on: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset
      aria-label={t('回复这条消息')}
      data-testid="composer-reply-bar"
      className="m-0 mb-2 flex h-7 min-w-0 items-center gap-1 border-0 p-0"
      onPointerEnter={() => onHighlight(true)}
      onPointerLeave={() => onHighlight(false)}
      onFocus={() => onHighlight(true)}
      onBlur={() => onHighlight(false)}
    >
      <Reply
        aria-hidden="true"
        width={22}
        height={22}
        className="flex-none text-content-secondary"
      />
      <p
        data-testid="composer-reply-quote"
        className="m-0 min-w-0 flex-1 truncate rounded-(--radius-control) bg-secondary px-3 py-1 text-meta leading-5 text-foreground"
      >
        {t('回复：{quote}', { quote: firstLine(quote) })}
      </p>
      <IconTooltip
        label={t('移除引用')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            data-testid="composer-reply-quote-remove"
            className={REMOVE_CLS}
            onClick={onRemove}
          />
        }
      >
        <X width={22} height={22} />
      </IconTooltip>
    </fieldset>
  );
}

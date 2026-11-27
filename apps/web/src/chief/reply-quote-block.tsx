import type { ParsedReplyQuoteItem } from '@cairn/shared';
import { X } from 'lucide-react';
import { Fragment } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import type { StagedQuote } from './reply-source-highlight.js';

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

export function QuotedReplies({
  quotes,
  hrefFor,
}: {
  quotes: readonly ParsedReplyQuoteItem[];
  hrefFor?: (sourceMessageId: string | null) => string | undefined;
}) {
  return quotes.map((item, index) => {
    const href = hrefFor?.(item.sourceMessageId);
    return (
      <Fragment key={`${index}:${item.sourceMessageId ?? ''}`}>
        <ReplyQuoteBlock quote={item.quote} {...(href === undefined ? {} : { sourceHref: href })} />
        {item.reply !== '' && (
          <div data-testid="reply-quote-answer" className="mb-3">
            <ChatMarkdown text={item.reply} />
          </div>
        )}
      </Fragment>
    );
  });
}

export function StagedQuotes({
  quotes,
  onRemove,
  onHighlight,
}: {
  quotes: readonly StagedQuote[];
  onRemove: (quote: StagedQuote) => void;
  onHighlight: (quote: StagedQuote | null) => void;
}) {
  const { t } = useI18n();
  if (quotes.length === 0) return null;
  return (
    <ul
      aria-label={t('要发送的引用')}
      data-testid="composer-quotes"
      className="m-0 mb-2 flex max-h-40 list-none flex-col gap-2 overflow-y-auto border-b border-border p-0 pb-2"
    >
      {quotes.map((quote) => (
        <li
          key={quote.id}
          data-testid="composer-quote"
          className="flex min-w-0 items-start gap-1"
          onPointerEnter={() => onHighlight(quote)}
          onPointerLeave={() => onHighlight(null)}
          onFocus={() => onHighlight(quote)}
          onBlur={() => onHighlight(null)}
        >
          <div className="min-w-0 flex-1 border-l-2 border-border pl-2.5">
            <p
              data-testid="composer-quote-text"
              className="m-0 truncate text-meta leading-5 text-content-secondary"
            >
              {quote.quote}
            </p>
            {quote.reply !== '' && (
              <p
                data-testid="composer-quote-reply"
                className="m-0 line-clamp-2 text-ui leading-5 whitespace-pre-wrap text-foreground"
              >
                {quote.reply}
              </p>
            )}
          </div>
          <IconTooltip
            label={t('移除引用')}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                data-testid="composer-quote-remove"
                className={REMOVE_CLS}
                onClick={() => onRemove(quote)}
              />
            }
          >
            <X className="size-5" />
          </IconTooltip>
        </li>
      ))}
    </ul>
  );
}

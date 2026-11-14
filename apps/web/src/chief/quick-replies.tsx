import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { useI18n } from '../i18n/provider.js';

export const REPLY_CHIP_CLS =
  'h-7 min-h-7 max-w-full cursor-pointer rounded-full border border-border bg-transparent px-2.5 py-0 text-left text-ui font-normal whitespace-normal text-foreground hover:bg-(--menu-hover) dark:bg-transparent dark:hover:bg-(--menu-hover)';

export function QuickReplies({
  replies,
  hidden,
  onSend,
  onPreview,
}: {
  replies: readonly string[] | undefined;
  hidden: boolean;
  onSend: ((text: string) => void | Promise<void>) | undefined;
  onPreview: (text: string | null) => void;
}) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  if (hidden || onSend == null || replies == null || replies.length === 0) return null;
  const send = (text: string) => {
    onPreview(null);
    setSending(true);
    Promise.resolve()
      .then(() => onSend(text))
      .catch(() => undefined)
      .finally(() => setSending(false));
  };
  return (
    <MessageScrollerItem>
      <fieldset
        aria-label={t('建议回复')}
        data-testid="chief-quick-replies"
        className="m-0 mt-4 flex min-w-0 flex-wrap gap-3 border-0 p-0"
      >
        {replies.map((text) => (
          <Button
            key={text}
            variant="ghost"
            data-testid="chief-quick-reply"
            className={`${REPLY_CHIP_CLS} min-w-0`}
            disabled={sending}
            onClick={() => send(text)}
            onPointerEnter={() => onPreview(text)}
            onPointerLeave={() => onPreview(null)}
            onFocus={() => onPreview(text)}
            onBlur={() => onPreview(null)}
          >
            <span className="min-w-0 truncate">{text}</span>
          </Button>
        ))}
      </fieldset>
    </MessageScrollerItem>
  );
}

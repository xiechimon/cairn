import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

const QUICK_REPLY_CLS =
  'h-auto min-h-7 max-w-full cursor-pointer rounded-full bg-secondary px-3 py-1 text-left text-meta font-medium whitespace-normal text-foreground hover:bg-menu-hover dark:hover:bg-menu-hover';

export function QuickReplies({
  replies,
  hidden,
  onSend,
}: {
  replies: readonly string[] | undefined;
  hidden: boolean;
  onSend: ((text: string) => void | Promise<void>) | undefined;
}) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  if (hidden || onSend == null || replies == null || replies.length === 0) return null;
  const send = (text: string) => {
    setSending(true);
    Promise.resolve()
      .then(() => onSend(text))
      .catch(() => undefined)
      .finally(() => setSending(false));
  };
  return (
    <fieldset
      aria-label={t('建议回复')}
      data-testid="chief-quick-replies"
      className="mx-auto mb-2.5 flex w-[calc(100%-2rem)] max-w-160 min-w-0 flex-none flex-wrap gap-1.5 border-0 p-0"
    >
      {replies.map((text) => (
        <Button
          key={text}
          variant="ghost"
          data-testid="chief-quick-reply"
          className={QUICK_REPLY_CLS}
          disabled={sending}
          onClick={() => send(text)}
        >
          {text}
        </Button>
      ))}
    </fieldset>
  );
}

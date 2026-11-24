import { ChevronUp, Clock, X } from 'lucide-react';
import { useState } from 'react';
import { useNarrow } from '../board/use-narrow.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export interface QueuedMessage {
  id: string;
  text: string;
  held: boolean;
  sending: boolean;
}

const TAB_CLS =
  'relative z-0 mx-3 -mb-3 flex flex-col rounded-t-(--radius-composer) bg-(--card) pt-1 pb-3 inset-ring-1 inset-ring-border dark:bg-(--popover)';
const ROW_CLS = 'flex min-h-9 items-center gap-2 pr-2 pl-3 text-meta pointer-coarse:min-h-11';
const ICON_ACTION_CLS =
  'size-7 flex-none cursor-pointer text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground pointer-coarse:size-11';

export function QueueTabs({
  messages,
  onRemove,
}: {
  messages: readonly QueuedMessage[];
  onRemove?: ((message: QueuedMessage) => void) | undefined;
}) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const [expanded, setExpanded] = useState(false);
  if (messages.length === 0) return null;
  const cap = narrow ? 2 : 3;
  const shown = expanded ? messages : messages.slice(0, cap);
  const rest = messages.length - shown.length;
  return (
    <section
      data-testid="chief-queue"
      data-state="queued"
      aria-label={t('排队中的消息')}
      className={TAB_CLS}
    >
      <ul className="m-0 flex max-h-44 list-none flex-col overflow-y-auto p-0">
        {shown.map((message) => (
          <li key={message.id} data-testid="chief-queued-message" className={ROW_CLS}>
            <Clock className="size-4 flex-none text-(--text-tertiary)" />
            <span
              data-testid="chief-queued-message-text"
              className="min-w-0 flex-1 truncate text-foreground"
            >
              {message.text}
            </span>
            {onRemove !== undefined && !message.sending && (
              <IconTooltip
                label={message.held ? t('撤回') : t('删除')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-testid="chief-queued-remove"
                    className={ICON_ACTION_CLS}
                    onClick={() => onRemove(message)}
                  />
                }
              >
                <X className="size-5" />
              </IconTooltip>
            )}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <Button
          variant="ghost"
          size="xs"
          data-testid="chief-queue-more"
          className={`${ROW_CLS} h-auto justify-start gap-1 rounded-none font-normal text-(--text-secondary) hover:bg-(--menu-hover) hover:text-foreground`}
          onClick={() => setExpanded(true)}
        >
          {t('还有 {n} 条', { n: rest })}
          <ChevronUp className="size-4" />
        </Button>
      )}
    </section>
  );
}

import { ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useNarrow } from '../board/use-narrow.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { useI18n } from '../i18n/provider.js';
import { Clock, X } from '../icons/index.js';

export interface QueuedMessage {
  id: string;
  text: string;
  held: boolean;
  sending: boolean;
}

const TAB_CLS =
  'relative z-0 mx-3 -mb-3 flex flex-col rounded-t-(--radius-composer) bg-(--card) pt-1 pb-3 inset-ring-1 inset-ring-border dark:bg-(--popover)';
const ROW_CLS = 'flex min-h-9 items-center gap-2 pr-2 pl-3 text-meta pointer-coarse:min-h-11';
const ACTION_CLS =
  'h-7 flex-none cursor-pointer px-2 text-meta font-normal text-(--text-secondary) hover:bg-(--menu-hover) hover:text-foreground pointer-coarse:h-11';
const ICON_ACTION_CLS =
  'size-7 flex-none cursor-pointer text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground pointer-coarse:size-11';

export function QueueTabs({
  messages,
  editingId,
  onEdit,
  onSteer,
  onRemove,
  onCancelEdit,
}: {
  messages: readonly QueuedMessage[];
  editingId: string | null;
  onEdit?: ((message: QueuedMessage) => void) | undefined;
  onSteer?: ((message: QueuedMessage) => void) | undefined;
  onRemove?: ((message: QueuedMessage) => void) | undefined;
  onCancelEdit: () => void;
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
      data-state={editingId === null ? 'queued' : 'editing'}
      aria-label={t('排队中的消息')}
      className={TAB_CLS}
    >
      <ul className="m-0 flex max-h-44 list-none flex-col overflow-y-auto p-0">
        {shown.map((message) => {
          const editing = message.id === editingId;
          const idle = editingId === null;
          return (
            <li
              key={message.id}
              data-testid="chief-queued-message"
              data-state={editing ? 'editing' : undefined}
              aria-current={editing ? 'true' : undefined}
              className={`${ROW_CLS} ${editing ? 'bg-(--menu-hover)' : ''}`}
            >
              <Clock width={16} height={16} className="flex-none text-(--text-tertiary)" />
              {idle && onEdit !== undefined && !message.held && !message.sending ? (
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="chief-queued-message-text"
                  aria-label={t('编辑排队消息：{text}', { text: message.text })}
                  className="h-auto min-w-0 flex-1 cursor-text justify-start rounded-none px-0 py-1 text-meta font-normal text-foreground hover:bg-transparent dark:hover:bg-transparent"
                  onClick={() => onEdit(message)}
                >
                  <span className="truncate">{message.text}</span>
                </Button>
              ) : (
                <span
                  data-testid="chief-queued-message-text"
                  className={`min-w-0 flex-1 truncate ${editing || idle ? 'text-foreground' : 'text-(--text-tertiary)'}`}
                >
                  {message.text}
                </span>
              )}
              {editing && (
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="chief-queue-cancel-edit"
                  className={`${ACTION_CLS} gap-1.5`}
                  onClick={onCancelEdit}
                >
                  {t('取消')}
                  <Kbd>Esc</Kbd>
                </Button>
              )}
              {idle && onSteer !== undefined && !message.held && !message.sending && (
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="chief-queued-steer"
                  className={ACTION_CLS}
                  onClick={() => onSteer(message)}
                >
                  {t('插话')}
                </Button>
              )}
              {!editing && onRemove !== undefined && !message.sending && (
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
                  <X width={20} height={20} />
                </IconTooltip>
              )}
            </li>
          );
        })}
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
          <ChevronUp width={16} height={16} />
        </Button>
      )}
    </section>
  );
}

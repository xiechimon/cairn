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
  if (editingId !== null) {
    return (
      <div data-testid="chief-queue" data-state="editing" className={TAB_CLS}>
        <div className={ROW_CLS}>
          <span className="min-w-0 flex-1 truncate text-caption text-(--text-tertiary)">
            {t('编辑排队消息')}
          </span>
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
        </div>
      </div>
    );
  }
  const held = messages.some((message) => message.held);
  const cap = narrow ? 2 : 3;
  const shown = expanded ? messages : messages.slice(0, cap);
  const rest = messages.length - shown.length;
  return (
    <section data-testid="chief-queue" aria-label={t('排队中的消息')} className={TAB_CLS}>
      <div className={`${ROW_CLS} text-caption text-(--text-tertiary)`}>
        <span className="min-w-0 flex-1 truncate">
          {held ? t('恢复后发出') : t('这一轮后发出')}
        </span>
        <span className="w-7 flex-none text-center pointer-coarse:w-11">{messages.length}</span>
      </div>
      <ul className="m-0 flex max-h-44 list-none flex-col overflow-y-auto p-0">
        {shown.map((message) => (
          <li key={message.id} data-testid="chief-queued-message" className={ROW_CLS}>
            <Clock width={16} height={16} className="flex-none text-(--text-tertiary)" />
            {onEdit !== undefined && !message.held && !message.sending ? (
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
                className="min-w-0 flex-1 truncate text-foreground"
              >
                {message.text}
              </span>
            )}
            {onSteer !== undefined && !message.held && !message.sending && (
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
                <X width={20} height={20} />
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
          <ChevronUp width={16} height={16} />
        </Button>
      )}
    </section>
  );
}

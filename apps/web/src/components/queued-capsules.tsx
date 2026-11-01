import { useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp, Clock, X } from '../icons/index.js';
import { IconTooltip } from './icon-tooltip.js';
import { Button } from './ui/button.js';
import { toastError } from './ui/toaster.js';

export interface QueuedCapsule {
  id: string;
  content: string;
  error?: string | null;
  note?: string;
  held?: boolean;
}

type CapsuleAction = (id: string, content: string) => unknown;

const CAPSULE_CLS =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full pr-1 pl-2.5 text-meta text-foreground inset-ring-1';
const CAPSULE_QUEUED_CLS = 'bg-background inset-ring-border';
const CAPSULE_FAILED_CLS = 'bg-(--danger-soft) inset-ring-destructive/40';
const CAPSULE_ICON_BTN = 'size-5 flex-none text-content-tertiary';

export function QueuedCapsules({
  messages,
  onSendNow,
  onRemove,
  removeLabel,
}: {
  messages: QueuedCapsule[];
  onSendNow?: CapsuleAction | undefined;
  onRemove?: CapsuleAction | undefined;
  removeLabel?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  if (messages.length === 0) return null;
  const run = (action: CapsuleAction, message: QueuedCapsule, failure: string) => {
    setBusy(message.id);
    void Promise.resolve()
      .then(() => action(message.id, message.content))
      .catch((error: unknown) => toastError(failure, error))
      .finally(() => setBusy(null));
  };
  const sendNow = (message: QueuedCapsule) => {
    if (onSendNow) run(onSendNow, message, t('插话失败，请重试。'));
  };
  const remove = (message: QueuedCapsule) => {
    if (onRemove) run(onRemove, message, t('取消失败，请重试。'));
  };
  return (
    <ul
      data-testid="queued-capsules"
      aria-label={t('排队中的消息')}
      className="flex flex-col items-start gap-1.5 pb-2.5"
    >
      {messages.map((message) => {
        const failed = message.error != null && message.error !== '';
        return (
          <li
            key={message.id}
            data-testid="queued-message"
            data-state={failed ? 'failed' : 'queued'}
            title={message.note ?? message.content}
            className={`${CAPSULE_CLS} ${failed ? CAPSULE_FAILED_CLS : CAPSULE_QUEUED_CLS}`}
          >
            <Clock
              width={14}
              height={14}
              className={`flex-none ${failed ? 'text-destructive' : 'text-content-tertiary'}`}
            />
            <span data-testid="queued-message-text" className="min-w-0 truncate">
              {message.content}
            </span>
            {failed && (
              <span
                data-testid="queued-message-error"
                className="flex-none font-medium text-destructive"
              >
                {message.error}
              </span>
            )}
            {failed && onSendNow && message.held !== true && (
              <Button
                variant="ghost"
                size="xs"
                className="flex-none text-destructive hover:bg-(--danger-soft) hover:text-destructive"
                disabled={busy !== null}
                data-testid="retry-queued-message"
                onClick={() => sendNow(message)}
              >
                {t('重试')}
              </Button>
            )}
            {!failed && onSendNow && message.held !== true && (
              <IconTooltip
                label={t('现在插话')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={CAPSULE_ICON_BTN}
                    disabled={busy !== null}
                    data-testid="steer-queued-message"
                    onClick={() => sendNow(message)}
                  />
                }
              >
                <ArrowUp width={12} height={12} />
              </IconTooltip>
            )}
            {onRemove && (
              <IconTooltip
                label={removeLabel ?? t('移除')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={CAPSULE_ICON_BTN}
                    disabled={busy !== null}
                    data-testid="cancel-queued-message"
                    onClick={() => remove(message)}
                  />
                }
              >
                <X width={12} height={12} />
              </IconTooltip>
            )}
          </li>
        );
      })}
    </ul>
  );
}

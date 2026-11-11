import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp, Check, Clock, X } from '../icons/index.js';
import { IconTooltip } from './icon-tooltip.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { toastError, toastSuccess } from './ui/toaster.js';

export interface QueuedCapsule {
  id: string;
  content: string;
  label?: string;
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
  onEdit,
  onEditSent,
  removeLabel,
}: {
  messages: QueuedCapsule[];
  onSendNow?: CapsuleAction | undefined;
  onRemove?: CapsuleAction | undefined;
  onEdit?: CapsuleAction | undefined;
  onEditSent?: ((content: string) => void) | undefined;
  removeLabel?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null);
  const [draft, setDraft] = useState('');
  const editingGone = editing !== null && !messages.some((message) => message.id === editing.id);
  const keepAfterSent = (content: string) => {
    setEditing(null);
    toastSuccess(t('这条排队消息已经发出，改动没有生效'));
    if (content !== '' && content !== editing?.original) onEditSent?.(content);
  };
  useEffect(() => {
    if (editingGone) keepAfterSent(draft.trim());
  });
  if (messages.length === 0) return null;
  const startEdit = (message: QueuedCapsule) => {
    setDraft(message.content);
    setEditing({ id: message.id, original: message.content });
  };
  const save = (message: QueuedCapsule) => {
    const content = draft.trim();
    if (content === '' || content === message.content || !onEdit) {
      setEditing(null);
      return;
    }
    setBusy(message.id);
    void Promise.resolve()
      .then(() => onEdit(message.id, content))
      .then(() => setEditing(null))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 409) keepAfterSent(content);
        else toastError(t('保存失败，请重试。'), error);
      })
      .finally(() => setBusy(null));
  };
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
      className="flex max-h-28 flex-col items-start gap-1.5 overflow-y-auto pb-2.5"
    >
      {messages.map((message) => {
        const failed = message.error != null && message.error !== '';
        if (editing?.id === message.id && !editingGone)
          return (
            <li
              key={message.id}
              data-testid="queued-message"
              data-state="editing"
              className="flex w-full flex-col gap-1"
            >
              <div className={`${CAPSULE_CLS} w-full bg-card inset-ring-(--focus-ring)`}>
                <Clock width={16} height={16} className="flex-none text-content-tertiary" />
                <Input
                  ref={(node) => node?.focus({ preventScroll: true })}
                  aria-label={t('编辑排队消息')}
                  data-testid="queued-message-input"
                  value={draft}
                  disabled={busy !== null}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      save(message);
                    }
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      setEditing(null);
                    }
                  }}
                  className="h-auto min-w-0 flex-1 outline-hidden border-0 bg-transparent p-0 text-meta text-foreground focus-visible:border-transparent focus-visible:ring-0 md:text-meta dark:bg-transparent"
                />
                <IconTooltip
                  label={t('保存')}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={CAPSULE_ICON_BTN}
                      disabled={busy !== null}
                      data-testid="save-queued-message"
                      onClick={() => save(message)}
                    />
                  }
                >
                  <Check width={12} height={12} />
                </IconTooltip>
                <IconTooltip
                  label={t('取消编辑')}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={CAPSULE_ICON_BTN}
                      data-testid="cancel-edit-queued-message"
                      onClick={() => setEditing(null)}
                    />
                  }
                >
                  <X width={12} height={12} />
                </IconTooltip>
              </div>
              <span className="pl-3 text-caption text-content-tertiary">
                {t('回车保存 · Esc 取消')}
              </span>
            </li>
          );
        return (
          <li
            key={message.id}
            data-testid="queued-message"
            data-state={failed ? 'failed' : 'queued'}
            title={message.note ?? message.label ?? message.content}
            className={`${CAPSULE_CLS} ${failed ? CAPSULE_FAILED_CLS : CAPSULE_QUEUED_CLS}`}
          >
            <Clock
              width={16}
              height={16}
              className={`flex-none ${failed ? 'text-destructive' : 'text-content-tertiary'}`}
            />
            {onEdit && !failed ? (
              <Button
                variant="ghost"
                aria-label={t('编辑排队消息')}
                data-testid="queued-message-text"
                disabled={busy !== null}
                onClick={() => startEdit(message)}
                className="h-auto min-w-0 shrink cursor-text justify-start rounded-sm p-0 text-meta font-normal text-foreground hover:bg-transparent dark:hover:bg-transparent"
              >
                <span className="truncate">{message.label ?? message.content}</span>
              </Button>
            ) : (
              <span data-testid="queued-message-text" className="min-w-0 truncate">
                {message.label ?? message.content}
              </span>
            )}
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

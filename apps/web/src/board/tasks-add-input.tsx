import { ArrowUp, ListChecks } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export function TasksAddInput({
  onSubmit,
  onClose,
}: {
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const trimmed = text.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '' || sending) return;
    setSending(true);
    onSubmit(trimmed)
      .then(
        () => setText(''),
        (error: unknown) => toastError(t('任务没有添加上，请重试。'), error),
      )
      .finally(() => {
        setSending(false);
        ref.current?.focus();
      });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <form onSubmit={submit} className="flex flex-none px-2">
      <div
        data-testid="tasks-add-field"
        className="flex h-10.5 min-w-0 flex-1 items-center gap-4 rounded-(--radius-tile) border border-transparent bg-(--hover-1) pr-1.5 pl-2.5 focus-within:[outline:var(--focus-width)_solid_var(--focus-ring)]"
      >
        <span className="flex size-7 flex-none items-center justify-center">
          <span
            data-slot="tasks-add-tile"
            className="flex size-6 items-center justify-center rounded-(--cds-radius-md) bg-(--sidebar-active)"
          >
            <ListChecks aria-hidden className="size-4 text-content-secondary" strokeWidth={1.75} />
          </span>
        </span>
        <Input
          ref={ref}
          data-testid="tasks-add-input"
          aria-label={t('添加任务…')}
          placeholder={t('添加任务…')}
          value={text}
          readOnly={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-full flex-1 border-0 bg-transparent p-0 outline-hidden text-ui text-foreground placeholder:text-content-tertiary focus-visible:ring-0 md:text-ui dark:bg-transparent"
        />
        <IconTooltip
          label={t('添加')}
          side="bottom"
          trigger={
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              data-testid="tasks-add-submit"
              disabled={trimmed === '' || sending}
              className="size-7 flex-none text-foreground disabled:text-content-tertiary disabled:opacity-100"
            />
          }
        >
          <ArrowUp aria-hidden className="size-5" strokeWidth={1.75} />
        </IconTooltip>
      </div>
    </form>
  );
}

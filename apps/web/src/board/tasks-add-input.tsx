import { CornerDownLeft } from 'lucide-react';
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
      .catch((error: unknown) => toastError(t('任务没有发出，请重试。'), error))
      .finally(() => setSending(false));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <form onSubmit={submit} className="flex flex-none items-center gap-1.5 px-3 pt-3">
      <Input
        ref={ref}
        data-testid="tasks-add-input"
        aria-label={t('添加任务…')}
        placeholder={t('添加任务…')}
        value={text}
        readOnly={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
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
            className="size-7.5 flex-none text-content-tertiary"
          />
        }
      >
        <CornerDownLeft aria-hidden className="size-4" strokeWidth={1.75} />
      </IconTooltip>
    </form>
  );
}

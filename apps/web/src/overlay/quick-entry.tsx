import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { DialogShell, VIEWPORT_POP_ANIM } from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { useQuickEntryHotkey } from '../overlays/hotkeys.js';

interface QuickEntryProps {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  onSubmit: (spec: string) => void;
  busy?: boolean;
}

export function QuickEntry({ open, onClose, onOpen, onSubmit, busy = false }: QuickEntryProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useQuickEntryHotkey(() => {
    if (open) onClose();
    else onOpen();
  });

  useEffect(() => {
    if (!open) {
      setText('');
      return;
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const submit = () => {
    const spec = text.trim();
    if (spec === '' || busy) return;
    onSubmit(spec);
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      viewportRoot
      backdropClassName="z-(--z-modal-scrim) bg-(--overlay-scrim) duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      zIndex="var(--z-modal)"
    >
      <div
        className={`fixed top-[18vh] left-1/2 z-(--z-modal) flex w-[606px] -ml-[303px] flex-col overflow-hidden rounded-(--edge-radius) bg-(--popover) shadow-(--floating-shadow) origin-top transition-[opacity,scale] group-data-closed/dlgvp:scale-[0.98] group-data-closed/dlgvp:opacity-0 motion-reduce:transition-none ${VIEWPORT_POP_ANIM}`}
        role="dialog"
        aria-label={t('新建任务')}
        data-testid="quick-entry"
      >
        <div className="flex flex-col gap-3 p-4">
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('有什么可以帮你的？')}
            rows={4}
            className="min-h-[96px] resize-none rounded-(--edge-radius) border-(--border) bg-(--secondary) px-3 py-3 text-[15px] leading-6 text-(--foreground) placeholder:text-(--text-tertiary) focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] leading-4 text-(--text-tertiary)">⌘⇧K · Esc</span>
            <Button
              type="button"
              size="sm"
              disabled={text.trim() === '' || busy}
              onClick={submit}
              data-testid="quick-entry-submit"
            >
              {t('保存并开始')}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

import { cn } from 'cn';
import { SquarePen } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { SettingsHeader } from './settings-list.js';
import { Button } from './ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from './ui/dialog-shell.js';
import { Input } from './ui/input.js';

export function useEditorFocus<T extends HTMLElement>(editing: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  return ref;
}

interface ProfileHeaderProps {
  avatar: ReactNode;
  name: string;
  sub?: string;
  onRename: (next: string) => unknown;
  className?: string;
  avatarClassName?: string;
  nameClassName?: string;
  editClassName?: string;
  inputId?: string;
}

export function ProfileHeader({
  avatar,
  name,
  sub,
  onRename,
  className,
  avatarClassName,
  nameClassName,
  editClassName,
  inputId,
}: ProfileHeaderProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useEditorFocus<HTMLInputElement>(editing);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const save = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next === '' || next === name) {
      setDraft(null);
      return;
    }
    Promise.resolve(onRename(next)).then(
      () => setDraft(null),
      () => {},
    );
  };
  return (
    <SettingsHeader
      className={className}
      avatar={avatar}
      avatarClassName={avatarClassName}
      title={name}
      titleClassName={nameClassName}
      sub={sub}
      action={
        <Button
          ref={editRef}
          variant="outline"
          aria-label={t('编辑名称')}
          title={t('编辑名称')}
          className={cn(
            'h-8 flex-none gap-1.5 px-3 text-ui pointer-coarse:h-11 max-[640px]:size-11 max-[640px]:px-0',
            editClassName,
          )}
          onClick={() => setDraft(name)}
        >
          <SquarePen className="size-5" />
          <span className="max-[640px]:sr-only">{t('编辑名称')}</span>
        </Button>
      }
      editor={
        draft === null ? undefined : (
          <div className="flex min-w-0 flex-auto items-center gap-2">
            <Input
              id={inputId}
              ref={inputRef}
              aria-label={t('名称')}
              className="h-8 min-w-0 flex-auto bg-card text-ui pointer-coarse:h-11 md:text-ui"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  save();
                }
                if (event.key === 'Escape') setDraft(null);
              }}
            />
            <Button className={DIALOG_PRIMARY_BUTTON} onClick={save}>
              {t('保存')}
            </Button>
            <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={() => setDraft(null)}>
              {t('取消')}
            </Button>
          </div>
        )
      }
    />
  );
}

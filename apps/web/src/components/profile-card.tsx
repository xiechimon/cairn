// Identity header for the Paper settings list (account page, agent overview):
// SettingsHeader with an inline 编辑名称 editor. The card and rows below it
// come from settings-list.tsx.

import { cn } from 'cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { SettingsHeader } from './settings-list.js';
import { Button } from './ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from './ui/dialog-shell.js';
import { Input } from './ui/input.js';

/** Focus on entering edit mode; ref + effect because biome's a11y/noAutofocus is an error here. */
export function useEditorFocus<T extends HTMLElement>(editing: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  return ref;
}

interface ProfileHeaderProps {
  /** Avatar image node; the header owns the 56px circle around it. */
  avatar: ReactNode;
  name: string;
  sub: string;
  /** Receives a trimmed, non-empty name that differs from `name`. */
  onRename: (next: string) => void;
  className?: string;
  avatarClassName?: string;
  nameClassName?: string;
  editClassName?: string;
  inputId?: string;
}

/** Avatar and name above the settings card. 编辑名称 swaps the name for an
 *  input with 保存 / 取消; Enter saves, Esc cancels. */
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
  const inputRef = useEditorFocus<HTMLInputElement>(draft !== null);
  const save = () => {
    const next = (draft ?? '').trim();
    if (next !== '' && next !== name) onRename(next);
    setDraft(null);
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
          variant="ghost"
          className={cn('h-8', DIALOG_TEXT_BUTTON, editClassName)}
          onClick={() => setDraft(name)}
        >
          {t('编辑名称')}
        </Button>
      }
      editor={
        draft === null ? undefined : (
          <div className="flex min-w-0 flex-auto items-center gap-2">
            <Input
              id={inputId}
              ref={inputRef}
              aria-label={t('名称')}
              className="h-8 w-48 bg-card text-ui md:text-ui"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
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

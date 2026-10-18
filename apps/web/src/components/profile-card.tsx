// Paper settings list (DESIGN.md「设置列表」): identity header above one
// white card of 52px rows. Rows are only ever rendered or not rendered; the
// card draws dividers between rendered rows with divide-y, so a row hidden
// with CSS would still draw a divider against the card edge.

import { cn } from 'cn';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { Button } from './ui/button.js';
import { Card } from './ui/card.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  PICKER_ROW_SELECTED,
} from './ui/dialog-shell.js';
import { Input } from './ui/input.js';

const PROFILE_CARD_CLS =
  'profile-card gap-0 divide-y divide-border overflow-visible rounded-(--cds-radius-xl) py-0 ring-border';

/** Row box. Raw-div rows (agent memories, empty states) use it directly. */
export const PROFILE_ROW_CLS =
  'profile-row flex min-h-13 items-center justify-between gap-4 px-4 py-1.5';

export const PROFILE_HINT_CLS = 'profile-hint text-meta text-content-tertiary';

/** Value slot turned into a column: editor on top, actions under it. */
export const PROFILE_VALUE_EDITOR_CLS = 'min-w-0 flex-auto flex-col items-stretch gap-2';

/** Boxed select trigger shared by every select in a settings card. */
export const PROFILE_SELECT_TRIGGER_CLS =
  'h-8 rounded-md border-border bg-card text-ui shadow-xs dark:bg-input/30';

export function ProfileCard({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cn(PROFILE_CARD_CLS, className)}>{children}</Card>;
}

interface ProfileRowProps {
  label: string;
  hint?: string;
  className?: string;
  labelClassName?: string;
  hintClassName?: string;
  valueClassName?: string;
  children: ReactNode;
}

export function ProfileRow({
  label,
  hint,
  className,
  labelClassName,
  hintClassName,
  valueClassName,
  children,
}: ProfileRowProps) {
  const withHint = hint != null;
  return (
    <div className={cn(PROFILE_ROW_CLS, className)}>
      <span
        className={cn('profile-label flex min-w-0 flex-col', withHint && 'max-w-3/5 flex-auto')}
      >
        <span className={cn('profile-label-text text-ui text-foreground', labelClassName)}>
          {label}
        </span>
        {withHint && <span className={cn(PROFILE_HINT_CLS, hintClassName)}>{hint}</span>}
      </span>
      <span
        className={cn(
          'profile-value flex items-center gap-3 text-ui text-foreground',
          withHint && 'min-w-0 flex-auto justify-end',
          valueClassName,
        )}
      >
        {children}
      </span>
    </div>
  );
}

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
    <div className={cn('profile-header flex min-h-14 items-center gap-4 px-1', className)}>
      <span
        className={cn(
          'profile-avatar flex size-14 flex-none overflow-hidden rounded-full bg-card ring-1 ring-border [&_img]:block [&_img]:size-14',
          avatarClassName,
        )}
      >
        {avatar}
      </span>
      {draft === null ? (
        <>
          <div className="flex min-w-0 flex-auto flex-col gap-0.5">
            <h2
              className={cn(
                'm-0 truncate font-heading text-page font-medium text-foreground',
                nameClassName,
              )}
            >
              {name}
            </h2>
            <p className="m-0 text-meta text-content-tertiary">{sub}</p>
          </div>
          <Button
            variant="ghost"
            className={cn('h-8', DIALOG_TEXT_BUTTON, editClassName)}
            onClick={() => setDraft(name)}
          >
            {t('编辑名称')}
          </Button>
        </>
      ) : (
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
      )}
    </div>
  );
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

/** Single-choice segmented control: paper track, the chosen option a white tab
 *  with a 1px ring. Radio-group semantics with arrow-key movement. */
export function ProfileSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (option === undefined) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-8 items-center gap-0.5 rounded-md bg-canvas p-0.5"
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <Button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            variant="ghost"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-active={checked}
            data-testid={option.testId}
            className={cn(
              'h-7 rounded-(--cds-radius-md) px-3 text-ui font-normal text-content-secondary hover:bg-transparent hover:text-foreground dark:hover:bg-transparent',
              checked && cn(PICKER_ROW_SELECTED, 'font-medium text-foreground'),
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

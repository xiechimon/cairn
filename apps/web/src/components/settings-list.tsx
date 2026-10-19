// Paper settings list (DESIGN.md「页面模式 · 设置列表」): a header above one
// white card of 52px rows. Rows are only ever rendered or not rendered; the
// card draws dividers between rendered rows with divide-y, so a row hidden
// with CSS would still draw a divider against the card edge.

import { cn } from 'cn';
import type { ReactNode } from 'react';
import { FORM_CONTROL_CLS } from './form-layout.js';
import { Button } from './ui/button.js';
import { Card } from './ui/card.js';
import { DIALOG_PRIMARY_BUTTON } from './ui/dialog-shell.js';

/** The one card corner (DESIGN.md rounded.card, `--radius-card`). */
export const CARD_RADIUS_CLS = 'rounded-(--radius-card)';

const SETTINGS_CARD_CLS = cn(
  'settings-card gap-0 divide-y divide-border overflow-visible py-0 ring-border',
  CARD_RADIUS_CLS,
);

/** Row box. Raw-div rows (agent memories, empty rows) use it directly. */
export const SETTINGS_ROW_CLS =
  'settings-row flex min-h-13 items-center justify-between gap-4 px-4 py-1.5';

export const SETTINGS_HINT_CLS = 'text-meta text-content-tertiary';

/** Value slot turned into a column: editor on top, actions under it. */
export const SETTINGS_VALUE_EDITOR_CLS = 'min-w-0 flex-auto flex-col items-stretch gap-2';

/** Boxed select trigger shared by every select in a settings card. */
export const SETTINGS_SELECT_TRIGGER_CLS = FORM_CONTROL_CLS;

interface SettingsHeaderProps {
  /** Avatar or tile node; the header owns the 56px circle around it. */
  avatar?: ReactNode;
  title: string;
  sub?: string;
  /** Right-side control, usually a text button. */
  action?: ReactNode;
  /** Replaces title, sub and action while present (inline rename). */
  editor?: ReactNode;
  className?: string;
  avatarClassName?: string;
  titleClassName?: string;
}

export function SettingsHeader({
  avatar,
  title,
  sub,
  action,
  editor,
  className,
  avatarClassName,
  titleClassName,
}: SettingsHeaderProps) {
  return (
    <div className={cn('settings-header flex min-h-14 items-center gap-4 px-1', className)}>
      {avatar != null && (
        <span
          className={cn(
            'settings-avatar flex size-14 flex-none overflow-hidden rounded-full bg-card ring-1 ring-border [&_img]:block [&_img]:size-14',
            avatarClassName,
          )}
        >
          {avatar}
        </span>
      )}
      {editor ?? (
        <>
          <div className="flex min-w-0 flex-auto flex-col gap-0.5">
            <h2
              className={cn(
                'm-0 truncate font-heading text-page font-medium text-foreground',
                titleClassName,
              )}
            >
              {title}
            </h2>
            {sub != null && <p className="m-0 text-meta text-content-tertiary">{sub}</p>}
          </div>
          {action}
        </>
      )}
    </div>
  );
}

export function SettingsCard({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cn(SETTINGS_CARD_CLS, className)}>{children}</Card>;
}

interface SettingsRowProps {
  label: string;
  hint?: string;
  className?: string;
  labelClassName?: string;
  hintClassName?: string;
  valueClassName?: string;
  children: ReactNode;
}

export function SettingsRow({
  label,
  hint,
  className,
  labelClassName,
  hintClassName,
  valueClassName,
  children,
}: SettingsRowProps) {
  const withHint = hint != null;
  return (
    <div className={cn(SETTINGS_ROW_CLS, className)}>
      <span className={cn('flex min-w-0 flex-col', withHint && 'max-w-3/5 flex-auto')}>
        <span className={cn('settings-label-text text-ui text-foreground', labelClassName)}>
          {label}
        </span>
        {withHint && <span className={cn(SETTINGS_HINT_CLS, hintClassName)}>{hint}</span>}
      </span>
      <span
        className={cn(
          'flex items-center gap-3 text-ui text-foreground',
          withHint && 'min-w-0 flex-auto justify-end',
          valueClassName,
        )}
      >
        {children}
      </span>
    </div>
  );
}

interface SettingsDangerZoneProps {
  label: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
  disabled?: boolean;
  className?: string;
}

/** Danger-zone row in a card of its own, last on the page: label and
 *  description left, a destructive button in the standard 32px shape right. */
export function SettingsDangerZone({
  label,
  description,
  actionLabel,
  onAction,
  disabled,
  className,
}: SettingsDangerZoneProps) {
  return (
    <SettingsCard className={className}>
      <SettingsRow label={label} hint={description}>
        <Button
          variant="destructive"
          className={DIALOG_PRIMARY_BUTTON}
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

/** Single-choice control inside a settings row: the shared segmented radio. */
export { SegmentedRadio as SettingsSegmented } from './segmented.js';

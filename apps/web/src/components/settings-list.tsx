import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';
import { createContext, useContext, useId } from 'react';
import { FORM_CONTROL_CLS } from './form-layout.js';
import { Button } from './ui/button.js';
import { Card } from './ui/card.js';
import { DIALOG_PRIMARY_BUTTON } from './ui/dialog-shell.js';
import { SelectTrigger } from './ui/select.js';

export const CARD_RADIUS_CLS = 'rounded-(--radius-card)';

const SETTINGS_CARD_CLS = cn(
  'settings-card gap-0 divide-y divide-border overflow-visible py-0 ring-border',
  CARD_RADIUS_CLS,
);

export const SETTINGS_ROW_CLS =
  'settings-row flex min-h-13 items-center justify-between gap-4 px-4 py-1.5';

export const SETTINGS_HINT_CLS = 'text-meta text-content-tertiary';

export const SETTINGS_VALUE_EDITOR_CLS = 'min-w-0 flex-auto flex-col items-stretch gap-2';

export const SETTINGS_SELECT_TRIGGER_CLS = FORM_CONTROL_CLS;

interface SettingsHeaderProps {
  avatar?: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
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

const SettingsRowLabelContext = createContext<string | null>(null);

export function useSettingsRowLabelId(): string | null {
  return useContext(SettingsRowLabelContext);
}

export function SettingsSelectTrigger({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  const labelId = useContext(SettingsRowLabelContext);
  const labelledby = ariaLabelledby ?? (ariaLabel == null ? (labelId ?? undefined) : undefined);
  return <SelectTrigger {...props} aria-label={ariaLabel} aria-labelledby={labelledby} />;
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
  const labelId = useId();
  return (
    <div className={cn(SETTINGS_ROW_CLS, className)}>
      <span className={cn('flex min-w-0 flex-col', withHint && 'max-w-3/5 flex-auto')}>
        <span
          id={labelId}
          className={cn('settings-label-text text-ui text-foreground', labelClassName)}
        >
          {label}
        </span>
        {withHint && <span className={cn(SETTINGS_HINT_CLS, hintClassName)}>{hint}</span>}
      </span>
      <SettingsRowLabelContext.Provider value={labelId}>
        <span
          className={cn(
            'flex items-center gap-3 text-ui text-foreground',
            withHint && 'min-w-0 flex-auto justify-end',
            valueClassName,
          )}
        >
          {children}
        </span>
      </SettingsRowLabelContext.Provider>
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

export { SegmentedRadio as SettingsSegmented } from './segmented.js';

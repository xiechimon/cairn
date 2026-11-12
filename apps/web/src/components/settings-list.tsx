import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';
import { createContext, useContext, useEffect, useId, useRef } from 'react';
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
            'flex size-14 flex-none overflow-hidden rounded-full bg-card ring-1 ring-foreground/8 [&_img]:block [&_img]:size-14',
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
              className={cn('m-0 truncate voice-title text-page text-foreground', titleClassName)}
            >
              {title}
            </h2>
            {sub != null && <p className="m-0 text-ui text-content-secondary">{sub}</p>}
          </div>
          {action}
        </>
      )}
    </div>
  );
}

const SettingsFlatContext = createContext(false);

const SettingsRowsContext = createContext(false);

const SettingsMatchContext = createContext<string | null>(null);

export const SettingsMatchProvider = SettingsMatchContext.Provider;

const SETTINGS_ROWS_CLS = 'settings-card flex flex-col divide-y divide-border';

export function SettingsRows({ children }: { children: ReactNode }) {
  return <SettingsRowsContext.Provider value>{children}</SettingsRowsContext.Provider>;
}

export const SETTINGS_VALUE_COL_CLS = '@xl:w-56 @xl:flex-none justify-end';

const SETTINGS_FLAT_CLS =
  'rounded-none bg-transparent shadow-none ring-0 border-t border-border [&_.settings-row]:px-0 [&_.settings-flat-block]:px-0';

export function SettingsFlat({ children }: { children: ReactNode }) {
  return <SettingsFlatContext.Provider value>{children}</SettingsFlatContext.Provider>;
}

export function SettingsCard({ className, children }: { className?: string; children: ReactNode }) {
  const flat = useContext(SettingsFlatContext);
  const rows = useContext(SettingsRowsContext);
  if (rows) return <div className={cn(SETTINGS_ROWS_CLS, className)}>{children}</div>;
  return (
    <Card className={cn(SETTINGS_CARD_CLS, flat && SETTINGS_FLAT_CLS, className)}>{children}</Card>
  );
}

export function SettingsPanel({
  header,
  children,
  className,
}: {
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SettingsFlat>
      <div
        data-testid="settings-panel"
        className={cn(
          '@container flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) bg-card ring-1 ring-border',
          className,
        )}
      >
        {header != null && (
          <div className="flex min-h-11 flex-none items-center justify-between gap-3 border-b border-border px-4">
            {header}
          </div>
        )}
        {children}
      </div>
    </SettingsFlat>
  );
}

interface SettingsRowProps {
  label: string;
  hint?: ReactNode;
  labelTestId?: string;
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
  labelTestId,
  className,
  labelClassName,
  hintClassName,
  valueClassName,
  children,
}: SettingsRowProps) {
  const withHint = hint != null;
  const flat = useContext(SettingsFlatContext);
  const rows = useContext(SettingsRowsContext);
  const matchLabel = useContext(SettingsMatchContext);
  const matched = matchLabel === label;
  const labelId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matched) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [matched]);
  return (
    <div
      ref={rowRef}
      data-settings-label={label}
      data-match={matched ? '' : undefined}
      className={cn(
        SETTINGS_ROW_CLS,
        rows && 'relative isolate min-h-13.5 px-0 py-2',
        matched &&
          'before:absolute before:-inset-x-1 before:inset-y-1 before:-z-10 before:rounded-md before:bg-(--spot-soft)',
        className,
      )}
    >
      <span className={cn('flex min-w-0 flex-col', withHint && 'max-w-3/5 flex-auto')}>
        <span
          id={labelId}
          data-testid={labelTestId}
          className={cn(
            'settings-label-text text-ui text-foreground',
            matched && 'underline decoration-(--card-button) decoration-wavy underline-offset-4',
            labelClassName,
          )}
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
            flat && valueClassName === undefined && SETTINGS_VALUE_COL_CLS,
            valueClassName,
          )}
        >
          {children}
        </span>
      </SettingsRowLabelContext.Provider>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  className,
  testId,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const flat = useContext(SettingsFlatContext);
  const rows = useContext(SettingsRowsContext);
  return (
    <section
      data-testid={testId}
      className={cn('flex flex-col', rows ? 'gap-3' : 'gap-2', className)}
    >
      <div className={cn('flex min-h-7 items-center justify-between gap-3', !flat && 'px-1')}>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 truncate text-card-title font-semibold text-foreground">{title}</h2>
          {description != null && (
            <p className="m-0 text-meta text-content-tertiary">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
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

import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Button } from './ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from './ui/dialog-shell.js';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field.js';

export const FORM_CONTROL_CLS =
  'h-8 rounded-md border-input bg-card text-ui shadow-xs pointer-coarse:h-11 pointer-coarse:data-[size=default]:h-11 md:text-ui dark:bg-input/30';

export function FormStack({ className, children }: { className?: string; children: ReactNode }) {
  return <FieldGroup className={cn('max-w-130 gap-4', className)}>{children}</FieldGroup>;
}

interface FormFieldProps {
  label: string;
  htmlFor: string;
  help?: ReactNode;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function FormField({ label, htmlFor, help, className, disabled, children }: FormFieldProps) {
  return (
    <Field className={className} data-disabled={disabled === true ? 'true' : undefined}>
      <FieldLabel htmlFor={htmlFor} className="text-ui font-medium text-foreground">
        {label}
      </FieldLabel>
      {children}
      {help != null && (
        <FieldDescription className="text-meta text-content-tertiary group-data-[disabled=true]/field:opacity-50">
          {help}
        </FieldDescription>
      )}
    </Field>
  );
}

interface FormActionsProps {
  primary?: {
    label: string;
    type?: 'submit' | 'button';
    onClick?: () => void;
    disabled?: boolean;
    testId?: string;
  };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
  hint?: ReactNode;
  className?: string;
}

export function FormActions({ primary, secondary, hint, className }: FormActionsProps) {
  return (
    <div className={cn('flex items-center justify-end gap-2 pt-2', className)}>
      {hint != null && (
        <p
          data-testid="form-actions-hint"
          className="m-0 mr-auto min-w-0 text-meta text-content-tertiary"
        >
          {hint}
        </p>
      )}
      {secondary != null && (
        <Button
          variant="ghost"
          className={cn(DIALOG_TEXT_BUTTON, 'pointer-coarse:h-11')}
          disabled={secondary.disabled}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </Button>
      )}
      {primary != null && (
        <Button
          type={primary.type ?? 'button'}
          className={cn(DIALOG_PRIMARY_BUTTON, 'flex-none pointer-coarse:h-11')}
          disabled={primary.disabled}
          data-testid={primary.testId}
          onClick={primary.onClick}
        >
          {primary.label}
        </Button>
      )}
    </div>
  );
}

import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Button } from './ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from './ui/dialog-shell.js';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field.js';

export const FORM_CONTROL_CLS =
  'h-8 rounded-md border-border bg-card text-ui shadow-xs md:text-ui dark:bg-input/30';

export function FormStack({ className, children }: { className?: string; children: ReactNode }) {
  return <FieldGroup className={cn('max-w-130 gap-4', className)}>{children}</FieldGroup>;
}

interface FormFieldProps {
  label: string;
  htmlFor: string;
  help?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, help, className, children }: FormFieldProps) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={htmlFor} className="text-ui font-medium text-foreground">
        {label}
      </FieldLabel>
      {children}
      {help != null && (
        <FieldDescription className="text-meta text-content-tertiary">{help}</FieldDescription>
      )}
    </Field>
  );
}

interface FormActionsProps {
  primary: { label: string; type?: 'submit' | 'button'; onClick?: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void };
  className?: string;
}

export function FormActions({ primary, secondary, className }: FormActionsProps) {
  return (
    <div className={cn('flex items-center justify-end gap-2 pt-2', className)}>
      {secondary != null && (
        <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={secondary.onClick}>
          {secondary.label}
        </Button>
      )}
      <Button
        type={primary.type ?? 'button'}
        className={DIALOG_PRIMARY_BUTTON}
        disabled={primary.disabled}
        onClick={primary.onClick}
      >
        {primary.label}
      </Button>
    </div>
  );
}

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { useEscClose } from '../../overlay/use-esc.js';
import { Button } from './button.js';
import {
  DIALOG_BODY_CLS,
  DIALOG_CLOSE_CLS,
  DIALOG_HEAD_CLS,
  DIALOG_PANEL_CLS,
  DIALOG_PRIMARY_BUTTON,
  DIALOG_SUBTITLE_CLS,
  DIALOG_TEXT_BUTTON,
  DIALOG_TITLE_CLS,
  DialogFootRow,
  type DialogSize,
  dialogWidth,
} from './dialog-shell.js';

interface AlertDialogShellProps {
  title: string;
  subtitle?: ReactNode;
  ariaLabel: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  hint?: ReactNode;
  className?: string;
  size?: DialogSize;
}

export function AlertDialogShell({
  title,
  subtitle,
  ariaLabel,
  open,
  onClose,
  children,
  footer,
  hint,
  className,
  size = 's',
}: AlertDialogShellProps) {
  const { t } = useI18n();
  useEscClose(onClose, open);

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop
          data-slot="alert-dialog-overlay"
          className="overlay-backdrop fixed inset-0 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onClick={onClose}
        />
        <AlertDialogPrimitive.Popup
          role="alertdialog"
          data-slot="alert-dialog-content"
          data-size={size}
          className={cn(
            'delete-confirm fixed top-1/2 left-1/2 z-(--z-dialog) grid-rows-[auto_minmax(0,1fr)_auto] -translate-x-1/2 -translate-y-1/2 outline-none [transition:visibility_0s_linear_var(--dur-overlay)] duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[ending-style]:invisible',
            DIALOG_PANEL_CLS,
            className,
          )}
          style={{ width: dialogWidth(size) }}
          aria-label={ariaLabel}
        >
          <div data-testid="dialog-head" className={DIALOG_HEAD_CLS}>
            <div className="min-w-0 flex-1">
              <div className={cn('delete-confirm-title', DIALOG_TITLE_CLS)}>{title}</div>
              {subtitle != null && (
                <AlertDialogPrimitive.Description className={DIALOG_SUBTITLE_CLS}>
                  {subtitle}
                </AlertDialogPrimitive.Description>
              )}
            </div>
          </div>
          <div data-testid="dialog-body" className={DIALOG_BODY_CLS}>
            {children}
          </div>
          <DialogFootRow hint={hint}>{footer}</DialogFootRow>
          <AlertDialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('delete-confirm-close', DIALOG_CLOSE_CLS)}
              />
            }
            aria-label={t('关闭')}
            onClick={onClose}
          >
            <X width={16} height={16} />
          </AlertDialogPrimitive.Close>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export function AlertDialogActions({
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  confirmClassName,
}: {
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  confirmClassName?: string;
}) {
  return (
    <>
      <Button
        variant="ghost"
        className={`delete-confirm-cancel ${DIALOG_TEXT_BUTTON}`}
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      <Button
        variant="destructive"
        size="default"
        className={`${confirmClassName ?? 'delete-confirm-delete'} ${DIALOG_PRIMARY_BUTTON}`}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </>
  );
}

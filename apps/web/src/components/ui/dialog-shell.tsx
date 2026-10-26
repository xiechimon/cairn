import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { Button } from './button.js';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog.js';

const SHELL_EXIT_BRIDGE_CLS =
  '[transition:visibility_0s_linear_var(--dur-overlay)] data-[ending-style]:invisible';

const VIEWPORT_MECHANISM_CLS =
  'fixed inset-0 pointer-events-none [&>*]:pointer-events-auto [transition:visibility_0s_linear_var(--dur-fast)] data-[ending-style]:invisible';

export const VIEWPORT_POP_ANIM =
  'duration-100 ease-out group-data-open/dlgvp:animate-in group-data-open/dlgvp:fade-in-0 group-data-open/dlgvp:zoom-in-98';

export const DIALOG_FACE =
  'rounded-(--edge-radius) bg-dialog-surface shadow-(--dialog-shadow) ring-0';

export type DialogSize = 's' | 'm' | 'l';

export function dialogWidth(size: DialogSize): string {
  return `min(100% - 2rem, var(--dialog-w-${size}))`;
}

export const DIALOG_PANEL_CLS = `grid max-h-[calc(100vh-64px)] max-w-none gap-0 overflow-hidden p-0 text-ui text-popover-foreground sm:max-w-none ${DIALOG_FACE}`;

export const DIALOG_HEAD_CLS = 'flex items-start gap-3 pt-4.5 pr-13 pb-1 pl-5';

export const DIALOG_TITLE_CLS =
  'font-heading text-heading leading-[1.4] font-medium text-foreground';

export const DIALOG_SUBTITLE_CLS = 'mt-0.5 text-meta text-content-tertiary';

export const DIALOG_CLOSE_CLS =
  'absolute top-4 right-4 text-content-tertiary hover:text-foreground';

export const DIALOG_BODY_CLS = 'min-h-0 overflow-y-auto px-5 pt-3 pb-4';

export const DIALOG_FOOT_CLS = 'flex items-center gap-3 px-5 pt-3 pb-4';

export const DIALOG_HINT_CLS =
  'flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary [&_svg]:size-3 [&_svg]:flex-none';

export function DialogFootRow({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <div data-testid="dialog-foot" className={DIALOG_FOOT_CLS}>
      {hint != null && <div className={DIALOG_HINT_CLS}>{hint}</div>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export const DIALOG_PRIMARY_BUTTON =
  'rounded-md text-ui disabled:bg-secondary disabled:text-content-secondary disabled:opacity-100';

export const DIALOG_TEXT_BUTTON =
  'gap-1.5 px-3 text-ui font-normal text-content-secondary disabled:text-content-tertiary disabled:opacity-100';

export const PICKER_ROW_SELECTED =
  'bg-card shadow-xs ring-1 ring-border hover:bg-card dark:hover:bg-card';

interface DialogShellProps {
  title?: string;
  subtitle?: ReactNode;
  headerCenter?: ReactNode;
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  hint?: ReactNode;
  className?: string;
  size?: DialogSize;
  bare?: boolean;
  width?: number;
  height?: number;
  zIndex?: number | string;
  onBackdropClick?: () => void;
  onEscapeWhileNested?: () => void;
  viewportRoot?: boolean;
  backdropClassName?: string;
}

function useReturnFocus(open: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const record = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        el !== document.body &&
        el.closest('[data-slot="dialog-content"]') == null
      ) {
        origin.current = el;
      }
    };
    record();
    document.addEventListener('focusin', record);
    return () => document.removeEventListener('focusin', record);
  }, [open]);
  const restore = useCallback(() => {
    origin.current?.focus();
  }, []);
  return { restore };
}

export function DialogShell({
  title,
  subtitle,
  headerCenter,
  open = true,
  onClose,
  children,
  footer,
  hint,
  className,
  size = 'm',
  width,
  height,
  bare = false,
  zIndex = 'var(--z-dialog)',
  onBackdropClick,
  onEscapeWhileNested,
  viewportRoot = false,
  backdropClassName,
}: DialogShellProps) {
  const { t } = useI18n();
  const { restore } = useReturnFocus(open);

  const handleOpenChange = (next: boolean, details?: { reason?: string }) => {
    if (next) return;
    if (details?.reason === 'escape-key' && onEscapeWhileNested != null) {
      onEscapeWhileNested();
      return;
    }
    if (onEscapeWhileNested != null && details?.reason === 'outside-press') {
      return;
    }
    onClose();
  };

  if (viewportRoot || bare) {
    const backdropZ = typeof zIndex === 'number' ? zIndex - 1 : `calc(${zIndex} - 1)`;
    const backdropClass = viewportRoot
      ? `fixed inset-0${backdropClassName == null ? '' : ` ${backdropClassName}`}`
      : 'fixed inset-0 flex items-center justify-center duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0';
    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop
            data-slot="dialog-overlay"
            style={{ zIndex: backdropZ }}
            className={backdropClass}
            onClick={onBackdropClick ?? onClose}
          />
          <DialogPrimitive.Popup
            data-slot="dialog-content"
            finalFocus={restore}
            className={
              viewportRoot
                ? `${VIEWPORT_MECHANISM_CLS} group/dlgvp${className != null ? ` ${className}` : ''}`
                : `${SHELL_EXIT_BRIDGE_CLS}${className != null ? ` ${className}` : ''} fixed top-1/2 left-1/2 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden ${DIALOG_FACE} text-ui text-popover-foreground outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`
            }
            style={
              viewportRoot
                ? { zIndex }
                : {
                    width: width ?? dialogWidth(size),
                    zIndex,
                    ...(height == null ? {} : { height }),
                  }
            }
            role={viewportRoot ? 'presentation' : 'dialog'}
            aria-label={viewportRoot ? undefined : title}
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        finalFocus={restore}
        showCloseButton={false}
        aria-label={title}
        data-size={size}
        style={{ width: dialogWidth(size) }}
        className={cn(
          DIALOG_PANEL_CLS,
          footer != null || hint != null
            ? 'grid-rows-[auto_minmax(0,1fr)_auto]'
            : 'grid-rows-[auto_minmax(0,1fr)]',
          className,
        )}
      >
        <div
          data-testid="dialog-head"
          className={cn(DIALOG_HEAD_CLS, headerCenter != null && 'items-center pl-13')}
        >
          {headerCenter != null ? (
            <div className="flex min-w-0 flex-1 justify-center">{headerCenter}</div>
          ) : (
            <div className="min-w-0 flex-1">
              {title != null && <DialogTitle className={DIALOG_TITLE_CLS}>{title}</DialogTitle>}
              {subtitle != null && (
                <DialogDescription className={DIALOG_SUBTITLE_CLS}>{subtitle}</DialogDescription>
              )}
            </div>
          )}
        </div>
        <div data-testid="dialog-body" className={DIALOG_BODY_CLS}>
          {children}
        </div>
        {(footer != null || hint != null) && <DialogFootRow hint={hint}>{footer}</DialogFootRow>}
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className={DIALOG_CLOSE_CLS} />}
          aria-label={t('关闭')}
        >
          <X width={16} height={16} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

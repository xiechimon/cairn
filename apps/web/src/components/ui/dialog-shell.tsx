import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';
import { type ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { IconTooltip } from '../icon-tooltip.js';
import { InfoTip } from '../info-tip.js';
import { Button } from './button.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from './dialog.js';

const SHELL_EXIT_BRIDGE_CLS =
  '[transition:visibility_0s_linear_var(--dur-overlay)] data-[ending-style]:invisible';

const VIEWPORT_MECHANISM_CLS =
  'fixed inset-0 pointer-events-none [&>*]:pointer-events-auto data-[ending-style]:[transition:opacity_0s_linear_var(--dur-fast)] data-[ending-style]:opacity-0';

export const VIEWPORT_POP_ANIM =
  'duration-100 ease-(--ease-out-expo) group-data-open/dlgvp:animate-in group-data-open/dlgvp:fade-in-0 group-data-open/dlgvp:zoom-in-98';

export const DIALOG_FACE =
  'rounded-(--edge-radius) bg-dialog-surface shadow-(--dialog-shadow) ring-0';

export type DialogSize = 's' | 'm' | 'l';

export function dialogWidth(size: DialogSize): string {
  return `min(100% - 2rem, var(--dialog-w-${size}))`;
}

export const DIALOG_PANEL_CLS = `grid max-h-[calc(100vh-64px)] max-w-none gap-0 overflow-hidden p-0 text-ui text-popover-foreground sm:max-w-none ${DIALOG_FACE}`;

export const DIALOG_HEAD_CLS = 'flex items-start gap-3 pt-4 pr-13 pb-1 pl-4';

export const DIALOG_TITLE_CLS =
  'font-heading text-heading leading-[1.4] font-semibold text-foreground';

export const DIALOG_SUBTITLE_CLS = 'mt-1 text-meta text-content-tertiary';

export const DIALOG_CLOSE_CLS =
  'absolute top-4 right-4 text-content-tertiary hover:text-foreground pointer-coarse:top-2 pointer-coarse:right-2 pointer-coarse:size-11';

export const DIALOG_BODY_CLS =
  'min-h-0 overflow-y-auto [overflow-anchor:none] scrollbar-gutter-stable px-4 pt-4 pb-4';

export const DIALOG_FOOT_CLS = 'flex items-center gap-3 px-4 pt-4 pb-4';

export const DIALOG_HINT_CLS =
  'flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary [&_svg]:size-3 [&_svg]:flex-none';

export function DialogFootRow({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <div data-testid="dialog-foot" className={DIALOG_FOOT_CLS}>
      {hint != null && <div className={DIALOG_HINT_CLS}>{hint}</div>}
      <div className="ml-auto flex flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export const DIALOG_PRIMARY_BUTTON = 'rounded-md text-ui pointer-coarse:h-11';

export const DIALOG_TEXT_BUTTON =
  'gap-1.5 rounded-md bg-secondary px-3 text-ui font-normal text-foreground pointer-coarse:h-11 hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] disabled:text-content-tertiary disabled:opacity-100 dark:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]';

export const PICKER_ROW_SELECTED =
  'bg-card shadow-xs ring-1 ring-border hover:bg-card dark:hover:bg-card';

interface DialogShellProps {
  title?: string;
  subtitle?: ReactNode;
  info?: string;
  headerCenter?: ReactNode;
  headerAction?: ReactNode;
  open?: boolean;
  onClose: (details?: { reason?: string; event?: Event }) => void;
  children: ReactNode;
  footer?: ReactNode;
  hint?: ReactNode;
  className?: string;
  size?: DialogSize;
  bare?: boolean;
  width?: number | string;
  height?: number | string;
  zIndex?: number | string;
  onBackdropClick?: () => void;
  onEscapeWhileNested?: () => void;
  viewportRoot?: boolean;
  backdropClassName?: string;
  stacked?: boolean;
  dismissible?: boolean;
  initialFocus?: DialogPrimitive.Popup.Props['initialFocus'];
  returnFocusTo?: HTMLElement;
}

function useReturnFocus(open: boolean, returnFocusTo: HTMLElement | undefined) {
  const shellId = useId();
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const record = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        el !== document.body &&
        el.closest(`[data-shell-id="${CSS.escape(shellId)}"]`) == null
      ) {
        origin.current = el;
      }
    };
    record();
    document.addEventListener('focusin', record);
    return () => document.removeEventListener('focusin', record);
  }, [open, shellId]);
  const restore = useCallback(() => {
    if (returnFocusTo !== undefined) return returnFocusTo.isConnected ? returnFocusTo : false;
    origin.current?.focus({ preventScroll: true });
  }, [returnFocusTo]);
  return { shellId, restore };
}

export function DialogShell({
  title,
  subtitle,
  info,
  headerCenter,
  headerAction,
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
  initialFocus,
  returnFocusTo,
  backdropClassName,
  stacked = false,
  dismissible = true,
}: DialogShellProps) {
  const { t } = useI18n();
  const { shellId, restore } = useReturnFocus(open, returnFocusTo);

  const handleOpenChange = (next: boolean, details?: { reason?: string; event?: Event }) => {
    if (next || !dismissible) return;
    if (details?.reason === 'escape-key' && onEscapeWhileNested != null) {
      onEscapeWhileNested();
      return;
    }
    if (onEscapeWhileNested != null && details?.reason === 'outside-press') {
      return;
    }
    onClose(details);
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
            onClick={dismissible ? (onBackdropClick ?? (() => onClose())) : undefined}
          />
          <DialogPrimitive.Popup
            data-slot="dialog-content"
            initialFocus={initialFocus}
            finalFocus={restore}
            data-shell-id={shellId}
            onKeyDown={(event) => {
              if (
                event.key === 'ArrowUp' ||
                event.key === 'ArrowDown' ||
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight' ||
                event.key === 'Home' ||
                event.key === 'End'
              ) {
                event.preventBaseUIHandler();
              }
            }}
            className={
              viewportRoot
                ? `${VIEWPORT_MECHANISM_CLS} group/dlgvp${className != null ? ` ${className}` : ''}`
                : `${SHELL_EXIT_BRIDGE_CLS}${className != null ? ` ${className}` : ''} fixed top-[calc(50%+(env(safe-area-inset-top)-env(safe-area-inset-bottom))/2)] left-1/2 flex max-h-[calc(100vh-48px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden ${DIALOG_FACE} text-ui text-popover-foreground outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`
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
            aria-modal={viewportRoot ? undefined : true}
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
      {stacked && (
        <DialogPortal>
          <DialogOverlay forceRender />
        </DialogPortal>
      )}
      <DialogContent
        initialFocus={initialFocus}
        finalFocus={restore}
        data-shell-id={shellId}
        showCloseButton={false}
        aria-label={title}
        data-size={size}
        style={{ width: width ?? dialogWidth(size) }}
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
              {title != null && (
                <div className="flex min-w-0 items-center gap-1.5">
                  <DialogTitle className={DIALOG_TITLE_CLS}>{title}</DialogTitle>
                  {info !== undefined && <InfoTip info={info} />}
                </div>
              )}
              {subtitle != null && (
                <DialogDescription className={DIALOG_SUBTITLE_CLS}>{subtitle}</DialogDescription>
              )}
            </div>
          )}
          {headerAction != null && headerCenter == null && (
            <div
              data-slot="dialog-head-action"
              className="-mt-0.5 flex flex-none items-center gap-2"
            >
              {headerAction}
            </div>
          )}
        </div>
        <div
          data-testid="dialog-body"
          className={cn(DIALOG_BODY_CLS, (footer != null || hint != null) && 'pb-1')}
        >
          {children}
        </div>
        {(footer != null || hint != null) && <DialogFootRow hint={hint}>{footer}</DialogFootRow>}
        {dismissible && (
          <IconTooltip
            label={t('关闭')}
            side="bottom"
            trigger={
              <DialogClose
                render={<Button variant="ghost" size="icon-sm" className={DIALOG_CLOSE_CLS} />}
              />
            }
          >
            <X width={20} height={20} />
          </IconTooltip>
        )}
      </DialogContent>
    </Dialog>
  );
}

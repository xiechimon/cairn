import { cn } from 'cn';
import { X } from 'lucide-react';
import { createContext, type ReactNode, type RefObject, useContext, useRef } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { DialogClose, DialogTitle } from '../components/ui/dialog.js';
import { DialogShell, dialogWidth } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { cancelDialogEscape, isDraggingSortable, isEditableTarget } from './hotkeys.js';

const RouteDialogClose = createContext<() => void>(() => undefined);

export const RouteDialogCloseProvider = RouteDialogClose.Provider;

const ignoreBackdropClick = () => undefined;

export function RouteDialog({
  title,
  size,
  actions,
  bleed = false,
  initialFocus,
  children,
}: {
  title: string;
  size: 'form' | 'page';
  actions?: ReactNode;
  bleed?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const onClose = useContext(RouteDialogClose);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <DialogShell
      bare
      title={title}
      onClose={(details) => {
        if (
          details?.reason === 'escape-key' &&
          (isEditableTarget(details.event?.target ?? null) || isDraggingSortable())
        ) {
          cancelDialogEscape(details as { cancel?: () => void; allowPropagation?: () => void });
          return;
        }
        onClose();
      }}
      zIndex="calc(var(--z-narrow-chrome) + 2)"
      onBackdropClick={ignoreBackdropClick}
      initialFocus={initialFocus ?? (size === 'page' ? bodyRef : undefined)}
      width={size === 'page' ? 'var(--settings-w)' : dialogWidth('m')}
      className={size === 'page' ? 'route-page-dialog h-(--settings-h)' : undefined}
    >
      <header
        data-testid="route-dialog-head"
        className={cn(
          'flex h-11 flex-none items-center gap-2 border-b border-border pr-12 pl-4',
          size === 'page' && 'desktop-titlebar-head',
        )}
      >
        <DialogTitle className="m-0 min-w-0 flex-1 truncate text-card-title font-semibold text-foreground">
          {title}
        </DialogTitle>
        {actions}
      </header>
      <div
        ref={bodyRef}
        tabIndex={-1}
        data-testid="route-dialog-body"
        className={cn('min-h-0 flex-auto overflow-y-auto outline-none', !bleed && 'px-4 pt-4 pb-5')}
      >
        {bleed ? children : <div className="mx-auto w-full max-w-192">{children}</div>}
      </div>
      <IconTooltip
        label={t('关闭')}
        side="bottom"
        trigger={
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="desktop-titlebar-no-drag absolute top-[calc(0.5rem+var(--route-dialog-top,0px))] right-3 text-content-tertiary hover:text-foreground pointer-coarse:top-(--route-dialog-top,0px) pointer-coarse:right-1 pointer-coarse:size-11"
              />
            }
          />
        }
      >
        <X className="size-5" />
      </IconTooltip>
    </DialogShell>
  );
}

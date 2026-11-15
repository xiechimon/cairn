import { cn } from 'cn';
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useRef,
} from 'react';
import { Button } from '../components/ui/button.js';
import { DialogClose, DialogTitle } from '../components/ui/dialog.js';
import { DialogShell, dialogWidth } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';
import { isEditableTarget } from './hotkeys.js';

const RouteDialogClose = createContext<() => void>(() => undefined);

export const RouteDialogCloseProvider = RouteDialogClose.Provider;

const ignoreBackdropClick = () => undefined;

function keepFieldEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && isEditableTarget(event.target)) event.stopPropagation();
}

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
  const attachBody = useCallback((body: HTMLDivElement | null) => {
    bodyRef.current = body;
    if (body === null) return;
    body.addEventListener('keydown', keepFieldEscape);
    return () => body.removeEventListener('keydown', keepFieldEscape);
  }, []);
  return (
    <DialogShell
      bare
      title={title}
      onClose={onClose}
      zIndex="calc(var(--z-narrow-chrome) + 2)"
      onBackdropClick={ignoreBackdropClick}
      initialFocus={initialFocus ?? (size === 'page' ? bodyRef : undefined)}
      width={size === 'page' ? 'var(--settings-w)' : dialogWidth('m')}
      className={size === 'page' ? 'route-page-dialog h-(--settings-h)' : undefined}
    >
      <header
        data-testid="route-dialog-head"
        className="flex h-11 flex-none items-center gap-2 border-b border-border pr-12 pl-4"
      >
        <DialogTitle className="m-0 min-w-0 flex-1 truncate text-card-title font-semibold text-foreground">
          {title}
        </DialogTitle>
        {actions}
      </header>
      <div
        ref={attachBody}
        tabIndex={-1}
        data-testid="route-dialog-body"
        className={cn('min-h-0 flex-auto overflow-y-auto outline-none', !bleed && 'px-4 pt-4 pb-5')}
      >
        {bleed ? children : <div className="mx-auto w-full max-w-192">{children}</div>}
      </div>
      <DialogClose
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-3 text-content-tertiary hover:text-foreground pointer-coarse:top-0 pointer-coarse:right-1 pointer-coarse:size-11"
          />
        }
        aria-label={t('关闭')}
      >
        <X width={20} height={20} />
      </DialogClose>
    </DialogShell>
  );
}

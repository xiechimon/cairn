import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefConversation, ChiefScrollProvider } from './chief-conversation.js';
import type { ChiefEarlier } from './use-chief-surface.js';

export { CHIEF_DRAFT_STORAGE_KEY } from './chief-conversation.js';

const WINDOW_CLS =
  'chief-drawer fixed right-2 bottom-2 z-(--z-floating) flex h-150 max-h-[calc(100dvh-1rem)] w-95 max-w-[calc(100dvw-1rem)] flex-col overflow-hidden rounded-(--radius-window) bg-(--card) shadow-[var(--edge-ring),var(--floating-shadow)]';

const WINDOW_MOTION_CLS =
  'origin-[calc(100%-1.25rem)_calc(100%-1.25rem)] transition-none ease-(--ease-drawer) data-closed:fill-mode-forwards data-open:animate-in data-open:fade-in-0 data-open:zoom-in-40 data-open:duration-(--dur-overlay) data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-40 data-closed:duration-(--dur-overlay)';

interface DrawerProps {
  open?: boolean;
  chief: ChiefContent;
  onSettings?: () => void;
  onClose: () => void;
  onSend?: (text: string, projectId: string | null) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
  earlier?: ChiefEarlier;
}

export function ChiefDrawer(props: DrawerProps) {
  const { open = true } = props;
  const { t } = useI18n();
  return (
    <DialogPrimitive.Root open={open} modal={false} disablePointerDismissal>
      <DialogPrimitive.Portal keepMounted>
        <DialogPrimitive.Popup
          render={
            <aside className={`${WINDOW_CLS} ${WINDOW_MOTION_CLS}`} aria-label={t('Coordinator')} />
          }
          initialFocus={false}
          finalFocus={false}
        >
          <ChiefScrollProvider open={open}>
            <ChiefConversation variant="drawer" {...props} />
          </ChiefScrollProvider>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

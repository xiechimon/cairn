import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { AskUserAnswer } from '@cairn/shared';
import { useState } from 'react';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefConversation, ChiefFollowArmed } from './chief-conversation.js';

export { CHIEF_DRAFT_STORAGE_KEY } from './chief-conversation.js';

const WINDOW_CLS =
  'chief-drawer fixed right-2 bottom-2 z-(--z-floating) flex h-150 max-h-[calc(100dvh-1rem)] w-95 max-w-[calc(100dvw-1rem)] flex-col overflow-hidden rounded-(--radius-window) bg-(--card) shadow-[var(--edge-ring),var(--floating-shadow)]';

const WINDOW_MOTION_CLS =
  'origin-[calc(100%-1.25rem)_calc(100%-1.25rem)] transition-none ease-(--ease-drawer) data-closed:fill-mode-forwards data-open:animate-in data-open:fade-in-0 data-open:zoom-in-40 data-open:duration-(--dur-window) data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-40 data-closed:duration-(--dur-overlay)';

interface DrawerProps {
  open?: boolean;
  chief: ChiefContent;
  onSettings?: () => void;
  onClose: () => void;
  onSend?: (text: string) => void | Promise<void>;
  onThread?: (title: string, index: number) => void;
  onNewThread?: () => void;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
}

export function ChiefDrawer(props: DrawerProps) {
  const { open = true, chief } = props;
  const { t } = useI18n();
  const [threadsOpen, setThreadsOpen] = useState(chief.threadsOpen ?? false);
  const [atBottom, setAtBottom] = useState(true);
  return (
    <DialogPrimitive.Root
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next: boolean, details?: { reason?: string }) => {
        if (next) return;
        if (details?.reason === 'escape-key' && threadsOpen) setThreadsOpen(false);
      }}
    >
      <DialogPrimitive.Portal keepMounted>
        <DialogPrimitive.Popup
          render={<aside className={`${WINDOW_CLS} ${WINDOW_MOTION_CLS}`} aria-label={t('总管')} />}
          initialFocus={false}
          finalFocus={false}
        >
          <MessageScrollerProvider
            autoScroll={open && atBottom}
            scrollEdgeThreshold={FOLLOW_THRESHOLD}
            defaultScrollPosition="end"
          >
            <ChiefFollowArmed onAtBottom={setAtBottom} />
            <ChiefConversation
              variant="drawer"
              {...props}
              threadsOpen={threadsOpen}
              setThreadsOpen={setThreadsOpen}
            />
          </MessageScrollerProvider>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

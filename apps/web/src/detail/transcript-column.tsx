import { forwardRef, useImperativeHandle } from 'react';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  useMessageScroller,
} from '../components/ui/message-scroller.js';
import type { TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowDown } from '../icons/index.js';
import { QueuedMessages } from './queued-messages.js';
import { SpecBlock } from './spec-block.js';
import { type LiveStep, Transcript } from './transcript.js';

const ROOT_CLS = 'h-auto min-h-0 flex-1';
const VIEWPORT_CLS = 'chat-col pt-5 pr-4 pb-(--chat-extra-space) pl-5';
const CONTENT_CLS = 'mx-auto block w-full max-w-(--chat-max-w) gap-0';

export interface TranscriptColumnHandle {
  scrollToEnd: () => void;
}

interface TranscriptColumnProps {
  transcript: TranscriptItem[];
  liveStep: LiveStep | null;
  agent: { displayName: string; avatarUrl: string | null } | null;
  onOpenPlan?: () => void;
  spec?: string;
  autoScroll: boolean;
  queuedMessages?: { id: string; content: string; error?: string | null }[];
  onCancelQueued?: (id: string, content: string) => Promise<unknown>;
  onSteerQueued?: (id: string, content: string) => Promise<unknown>;
}

export const TranscriptColumn = forwardRef<TranscriptColumnHandle, TranscriptColumnProps>(
  function TranscriptColumn({ autoScroll, ...rest }, ref) {
    return (
      <MessageScrollerProvider
        autoScroll={autoScroll}
        scrollEdgeThreshold={FOLLOW_THRESHOLD}
        defaultScrollPosition="end"
      >
        <TranscriptColumnInner {...rest} handleRef={ref} />
      </MessageScrollerProvider>
    );
  },
);

function TranscriptColumnInner({
  transcript,
  liveStep,
  agent,
  onOpenPlan,
  spec,
  queuedMessages,
  onSteerQueued,
  onCancelQueued,
  handleRef,
}: Omit<TranscriptColumnProps, 'autoScroll'> & {
  handleRef: React.ForwardedRef<TranscriptColumnHandle>;
}) {
  const { t } = useI18n();
  const { scrollToEnd } = useMessageScroller();
  useImperativeHandle(handleRef, () => ({ scrollToEnd: () => void scrollToEnd() }), [scrollToEnd]);
  return (
    <MessageScroller className={ROOT_CLS}>
      <FadeScrollerViewport data-testid="transcript-col" className={VIEWPORT_CLS}>
        <MessageScrollerContent className={CONTENT_CLS}>
          {spec != null && <SpecBlock spec={spec} />}
          <Transcript
            transcript={transcript}
            liveStep={liveStep}
            agent={agent}
            onOpenPlan={onOpenPlan}
          />
          <QueuedMessages
            messages={queuedMessages ?? []}
            onSteer={onSteerQueued}
            onCancel={onCancelQueued}
          />
        </MessageScrollerContent>
      </FadeScrollerViewport>
      <JumpToLatestButton>
        <ArrowDown width={16} height={16} />
        <span className="sr-only">{t('滚动到最新')}</span>
      </JumpToLatestButton>
    </MessageScroller>
  );
}

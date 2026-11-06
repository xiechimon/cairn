import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
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
import { openingAnchor } from './scroll-anchor.js';
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
  running?: boolean;
  threadKey?: string;
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
  running,
  threadKey,
  handleRef,
}: Omit<TranscriptColumnProps, 'autoScroll'> & {
  handleRef: React.ForwardedRef<TranscriptColumnHandle>;
}) {
  const { t } = useI18n();
  const { scrollToEnd } = useMessageScroller();
  useImperativeHandle(handleRef, () => ({ scrollToEnd: () => void scrollToEnd() }), [scrollToEnd]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchoredKey = useRef<string | undefined>(undefined);
  const anchor = running === undefined ? null : openingAnchor(running, transcript);
  useEffect(() => {
    if (anchor === null || anchoredKey.current === threadKey) return;
    anchoredKey.current = threadKey;
    if (anchor === 'end') {
      void scrollToEnd();
      return;
    }
    const bubbles = viewportRef.current?.querySelectorAll('[data-testid="user-bubble"]');
    bubbles?.item(bubbles.length - 1)?.scrollIntoView({ block: 'start' });
  }, [anchor, threadKey, scrollToEnd]);
  return (
    <MessageScroller className={ROOT_CLS}>
      <FadeScrollerViewport ref={viewportRef} data-testid="transcript-col" className={VIEWPORT_CLS}>
        <MessageScrollerContent className={CONTENT_CLS}>
          {spec != null && <SpecBlock spec={spec} />}
          <Transcript
            transcript={transcript}
            liveStep={liveStep}
            agent={agent}
            onOpenPlan={onOpenPlan}
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

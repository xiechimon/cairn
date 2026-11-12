import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { EarlierLoader, type EarlierPages } from '../components/chat/earlier-loader.js';
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
import { type LiveStep, Transcript } from './transcript.js';

const ROOT_CLS = 'h-auto min-h-0 min-w-0 flex-1 overscroll-none';
const VIEWPORT_CLS = 'chat-col px-4 pt-3 pb-(--chat-extra-space)';
const CONTENT_CLS =
  'mx-auto block w-full max-w-(--chat-max-w) min-w-0 gap-0 [overflow-wrap:anywhere]';

export interface TranscriptColumnHandle {
  scrollToEnd: () => void;
}

interface TranscriptColumnProps {
  transcript: TranscriptItem[];
  liveStep: LiveStep | null;
  agent: { displayName: string; avatarUrl: string | null } | null;
  onOpenPlan?: () => void;
  lead?: ReactNode;
  result?: ReactNode;
  autoScroll: boolean;
  running?: boolean;
  settled?: boolean;
  threadKey?: string;
  hasEarlier?: boolean;
  earlier?: EarlierPages;
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
  lead,
  result,
  running,
  settled = true,
  threadKey,
  hasEarlier = false,
  earlier,
  handleRef,
}: Omit<TranscriptColumnProps, 'autoScroll'> & {
  handleRef: React.ForwardedRef<TranscriptColumnHandle>;
}) {
  const { t } = useI18n();
  const { scrollToEnd } = useMessageScroller();
  useImperativeHandle(handleRef, () => ({ scrollToEnd: () => void scrollToEnd() }), [scrollToEnd]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchoredKey = useRef<string | undefined>(undefined);
  const [openedKey, setOpenedKey] = useState<string | undefined>(undefined);
  const anchor = running === undefined || !settled ? null : openingAnchor(running, transcript);
  useEffect(() => {
    if (anchor === null || anchoredKey.current === threadKey) return;
    anchoredKey.current = threadKey;
    if (anchor === 'end') {
      scrollToEnd();
    } else {
      const bubbles = viewportRef.current?.querySelectorAll('[data-testid="user-bubble"]');
      bubbles?.item(bubbles.length - 1)?.scrollIntoView({ block: 'start' });
    }
    setOpenedKey(threadKey);
  }, [anchor, threadKey, scrollToEnd]);
  return (
    <MessageScroller className={ROOT_CLS}>
      <FadeScrollerViewport
        ref={viewportRef}
        reserveEnd={false}
        data-testid="transcript-col"
        className={VIEWPORT_CLS}
      >
        <MessageScrollerContent className={CONTENT_CLS}>
          {lead}
          <Transcript
            key={threadKey}
            transcript={transcript}
            liveStep={liveStep}
            agent={agent}
            onOpenPlan={onOpenPlan}
            result={result}
          />
        </MessageScrollerContent>
      </FadeScrollerViewport>
      <JumpToLatestButton>
        <ArrowDown width={20} height={20} />
        <span className="sr-only">{t('滚动到最新')}</span>
      </JumpToLatestButton>
      {earlier !== undefined && settled && (openedKey === threadKey || transcript.length === 0) && (
        <EarlierLoader
          earlier={earlier}
          hasEarlier={hasEarlier}
          rowCount={transcript.length}
          viewportRef={viewportRef}
        />
      )}
    </MessageScroller>
  );
}

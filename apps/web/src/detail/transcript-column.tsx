import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTouchMessageTools } from '../chief/touch-message-tools.js';
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
const VIEWPORT_CLS = 'chat-col pt-3 pl-4 pr-[calc(1rem-var(--scrollbar-gutter,0px))]';
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
  shortEnd?: boolean;
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
  shortEnd = false,
  handleRef,
}: Omit<TranscriptColumnProps, 'autoScroll'> & {
  handleRef: React.ForwardedRef<TranscriptColumnHandle>;
}) {
  const { t } = useI18n();
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  useImperativeHandle(handleRef, () => ({ scrollToEnd: () => void scrollToEnd() }), [scrollToEnd]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  useTouchMessageTools(rows);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport == null) return;
    const gutter = viewport.offsetWidth - viewport.clientWidth;
    viewport.style.setProperty('--scrollbar-gutter', `${Math.min(gutter, 16)}px`);
  }, []);
  const compactEnd = shortEnd || running === false;
  const anchoredKey = useRef<string | undefined>(undefined);
  const [openedKey, setOpenedKey] = useState<string | undefined>(undefined);
  const anchor = running === undefined || !settled ? null : openingAnchor(running, transcript);
  useEffect(() => {
    if (anchor === null || anchoredKey.current === threadKey) return;
    anchoredKey.current = threadKey;
    if (anchor === 'end') {
      scrollToEnd();
    } else {
      const viewport = viewportRef.current;
      const bubbles = viewport?.querySelectorAll('[data-testid="user-bubble"]');
      const messageId = bubbles?.item(bubbles.length - 1)?.closest<HTMLElement>('[data-message-id]')
        ?.dataset.messageId;
      if (viewport != null && messageId !== undefined) {
        const opensAtTop = bubbles?.length === 1 && !hasEarlier;
        const fade = Number.parseFloat(
          getComputedStyle(viewport).getPropertyValue('--scroll-fade-size'),
        );
        scrollToMessage(messageId, {
          align: 'start',
          scrollMargin: opensAtTop ? viewport.scrollHeight : fade || 0,
        });
      }
    }
    setOpenedKey(threadKey);
  }, [anchor, threadKey, hasEarlier, scrollToEnd, scrollToMessage]);
  return (
    <MessageScroller className={ROOT_CLS}>
      <FadeScrollerViewport
        ref={viewportRef}
        reserveEnd={compactEnd}
        data-testid="transcript-col"
        className={compactEnd ? VIEWPORT_CLS : `${VIEWPORT_CLS} pb-(--chat-extra-space)`}
      >
        <MessageScrollerContent ref={setRows} className={CONTENT_CLS}>
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
      <JumpToLatestButton label={t('滚动到最新')}>
        <ArrowDown width={20} height={20} />
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

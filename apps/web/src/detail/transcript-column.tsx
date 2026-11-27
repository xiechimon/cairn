import { ArrowDown } from 'lucide-react';
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import type { TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { openingAnchor } from './scroll-anchor.js';
import { Transcript } from './transcript.js';

const ROOT_CLS = 'h-auto min-h-0 min-w-0 flex-1 pointer-fine:overscroll-none';
const VIEWPORT_CLS = 'chat-col pt-3 pl-4 pr-[calc(1rem-var(--scrollbar-gutter,0px))]';
const CONTENT_CLS =
  'mx-auto block w-full max-w-(--chat-max-w) min-w-0 gap-0 [overflow-wrap:anywhere]';

export interface TranscriptColumnHandle {
  scrollToEnd: () => void;
}

interface TranscriptColumnProps {
  transcript: TranscriptItem[];
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
    const [unpinned, setUnpinned] = useState(false);
    return (
      <MessageScrollerProvider
        autoScroll={autoScroll && !unpinned}
        scrollEdgeThreshold={FOLLOW_THRESHOLD}
        defaultScrollPosition="end"
      >
        <TranscriptColumnInner {...rest} handleRef={ref} setUnpinned={setUnpinned} />
      </MessageScrollerProvider>
    );
  },
);

function TranscriptColumnInner({
  transcript,
  lead,
  result,
  running,
  settled = true,
  threadKey,
  hasEarlier = false,
  earlier,
  handleRef,
  setUnpinned,
}: Omit<TranscriptColumnProps, 'autoScroll'> & {
  handleRef: React.ForwardedRef<TranscriptColumnHandle>;
  setUnpinned: (unpinned: boolean) => void;
}) {
  const { t } = useI18n();
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    if (!scrollable.end) setUnpinned(false);
  }, [scrollable.end, setUnpinned]);
  useImperativeHandle(handleRef, () => ({ scrollToEnd: () => void scrollToEnd() }), [scrollToEnd]);
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport == null) return;
    const gutter = viewport.offsetWidth - viewport.clientWidth;
    viewport.style.setProperty('--scrollbar-gutter', `${Math.min(gutter, 16)}px`);
  }, []);
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
        reserveEnd
        onClickCapture={(event) => {
          const toggle =
            event.target instanceof Element
              ? event.target.closest('[aria-expanded]:not([aria-haspopup])')
              : null;
          if (toggle !== null) setUnpinned(true);
        }}
        data-testid="transcript-col"
        className={VIEWPORT_CLS}
      >
        <MessageScrollerContent className={CONTENT_CLS}>
          {lead}
          <Transcript key={threadKey} transcript={transcript} result={result} />
        </MessageScrollerContent>
      </FadeScrollerViewport>
      <JumpToLatestButton label={t('滚动到最新')}>
        <ArrowDown className="size-5" />
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

import { ChevronUp } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLiveData } from '../api/provider.js';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import type { TodoGlance } from '../detail/segments.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefConversation, ChiefFollowArmed } from './chief-conversation.js';
import type { ChiefSurface } from './use-chief-surface.js';

const GREETINGS: [number, string][] = [
  [5, '夜深了'],
  [11, '早上好'],
  [13, '中午好'],
  [18, '下午好'],
  [24, '晚上好'],
];

export function greetingFor(hour: number): string {
  return GREETINGS.find(([until]) => hour < until)?.[1] ?? '晚上好';
}

interface ChiefHomeProps {
  surface: ChiefSurface;
  now: number;
  summary: ReactNode;
  below: ReactNode;
  brief: ReactNode;
  todoGlances: ReadonlyMap<string, TodoGlance>;
}

export function ChiefHome({ surface, now, summary, below, brief, todoGlances }: ChiefHomeProps) {
  const { t, locale } = useI18n();
  const { user } = useLiveData();
  const { chiefData, chiefView, setChiefView, onSend } = surface;
  const [threadsOpen, setThreadsOpen] = useState(chiefData.threadsOpen ?? false);
  const [atBottom, setAtBottom] = useState(true);
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const empty = (chiefData.stream?.length ?? 0) === 0;
  const [createdHere, setCreatedHere] = useState(false);
  const [day, setDay] = useState<{ threadId: string; earlier: number | null } | null>(null);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const streamAt = chiefData.streamAt ?? [];
  const threadId = chiefData.threadId ?? null;
  if (threadId != null && streamAt.length > 0 && day?.threadId !== threadId) {
    const todayFrom = streamAt.findIndex((at) => at >= startOfToday);
    const earlier = todayFrom === -1 ? streamAt.length : todayFrom;
    setDay({ threadId, earlier: createdHere || earlier === 0 ? null : earlier });
    if (createdHere) setCreatedHere(false);
  } else if (day?.earlier != null && day.threadId === threadId && streamAt.length < day.earlier) {
    setDay({ threadId: day.threadId, earlier: streamAt.length });
  }
  const dayEarlier = day?.threadId === threadId ? (day?.earlier ?? null) : null;
  const fresh = dayEarlier != null && streamAt.length === dayEarlier;

  useEffect(() => {
    if (chiefView !== 'drawer') return;
    setChiefView('none');
    composerRef.current?.focus({ preventScroll: true });
  }, [chiefView, setChiefView]);

  useEffect(() => {
    if (empty) setHeroCollapsed(false);
  }, [empty]);

  const send = useCallback(
    (text: string) => {
      if (onSend == null) return;
      if (empty) setCreatedHere(true);
      if (
        empty &&
        typeof document.startViewTransition === 'function' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        document.startViewTransition(() => {
          flushSync(() => setHeroCollapsed(true));
        });
      } else if (empty) {
        setHeroCollapsed(true);
      }
      const sent = Promise.resolve(onSend(text));
      if (empty)
        sent.catch(() => {
          setHeroCollapsed(false);
          setCreatedHere(false);
        });
      return sent;
    },
    [onSend, empty],
  );

  const greeting = t('{greeting}，{name}', {
    greeting: t(greetingFor(new Date(now).getHours())),
    name: user.displayName,
  });

  const hero = (
    <header
      data-testid="chief-home-hero"
      className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-[6vh]"
    >
      <h2 className="m-0 font-serif text-page font-normal text-foreground text-balance">
        {greeting}
      </h2>
      <div data-testid="chief-home-summary" className="mt-2 text-ui text-content-secondary">
        {summary}
      </div>
    </header>
  );

  const lastEarlierAt = dayEarlier != null ? (streamAt[dayEarlier - 1] ?? 0) : 0;
  const startOfYesterday = new Date(startOfToday).setDate(new Date(startOfToday).getDate() - 1);
  const today = dayEarlier != null && (
    <section
      data-testid="chief-home-today"
      aria-label={t('今天的概况')}
      className={`flex flex-col gap-5 pt-8 pb-6 ${fresh ? 'min-h-[calc(100dvh-18rem)]' : ''}`}
    >
      {fresh && (
        <p className="m-0 mb-auto flex items-center justify-center gap-1 text-meta text-content-tertiary">
          <ChevronUp aria-hidden strokeWidth={1.75} className="size-3.5" />
          {t(lastEarlierAt >= startOfYesterday ? '往上滑查看昨天的对话' : '往上滑查看之前的对话')}
        </p>
      )}
      <header>
        <h2 className="m-0 font-serif text-page font-normal text-foreground text-balance">
          {greeting}
        </h2>
        <p className="mt-2 mb-0 text-ui text-content-tertiary">
          {new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'short',
          }).format(now)}
        </p>
      </header>
      <div className={fresh ? 'mb-auto' : undefined}>{brief}</div>
    </section>
  );

  return (
    <section
      data-testid="chief-home"
      aria-label={t('与总管的对话')}
      data-layout={empty && !heroCollapsed ? 'hero' : fresh ? 'day' : 'chat'}
      className={`flex min-h-0 flex-1 flex-col ${empty && !heroCollapsed ? 'overflow-y-auto pb-10' : ''}`}
    >
      <MessageScrollerProvider
        autoScroll={atBottom}
        scrollEdgeThreshold={FOLLOW_THRESHOLD}
        defaultScrollPosition="end"
      >
        <ChiefFollowArmed onAtBottom={setAtBottom} />
        <ChiefConversation
          variant="home"
          chief={chiefData}
          onSend={onSend != null ? send : undefined}
          onThread={surface.onThread}
          onNewThread={surface.onNewThread}
          onRewind={surface.onRewind}
          onAnswerQuestion={surface.onAnswerQuestion}
          onCancelQuestion={surface.onCancelQuestion}
          onSettings={() => setChiefView('settings')}
          threadsOpen={threadsOpen}
          setThreadsOpen={setThreadsOpen}
          hero={hero}
          below={below}
          heroCollapsed={heroCollapsed}
          todoGlances={todoGlances}
          day={dayEarlier != null ? { earlier: dayEarlier, today } : undefined}
          composerRef={(node) => {
            composerRef.current = node;
          }}
        />
      </MessageScrollerProvider>
    </section>
  );
}

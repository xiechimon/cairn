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
  todoGlances: ReadonlyMap<string, TodoGlance>;
  onNewTask?: () => void;
}

export function ChiefHome({
  surface,
  now,
  summary,
  below,
  todoGlances,
  onNewTask,
}: ChiefHomeProps) {
  const { t } = useI18n();
  const { user } = useLiveData();
  const { chiefData, chiefView, setChiefView, onSend } = surface;
  const [threadsOpen, setThreadsOpen] = useState(chiefData.threadsOpen ?? false);
  const [atBottom, setAtBottom] = useState(true);
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const empty = (chiefData.stream?.length ?? 0) === 0;

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
      if (empty) sent.catch(() => setHeroCollapsed(false));
      return sent;
    },
    [onSend, empty],
  );

  const hero = (
    <header
      data-testid="chief-home-hero"
      className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-[6vh]"
    >
      <h2 className="m-0 font-serif text-page font-normal text-foreground text-balance">
        {t('{greeting}，{name}', {
          greeting: t(greetingFor(new Date(now).getHours())),
          name: user.displayName,
        })}
      </h2>
      <div data-testid="chief-home-summary" className="mt-2 text-ui text-content-secondary">
        {summary}
      </div>
    </header>
  );

  return (
    <section
      data-testid="chief-home"
      aria-label={t('与总管的对话')}
      data-layout={empty && !heroCollapsed ? 'hero' : 'chat'}
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
          onWithdraw={surface.onWithdraw}
          onSteer={surface.onSteer}
          onStop={surface.onStop}
          onNewTask={onNewTask}
          onSettings={() => setChiefView('settings')}
          threadsOpen={threadsOpen}
          setThreadsOpen={setThreadsOpen}
          hero={hero}
          below={below}
          heroCollapsed={heroCollapsed}
          todoGlances={todoGlances}
          composerRef={(node) => {
            composerRef.current = node;
          }}
        />
      </MessageScrollerProvider>
    </section>
  );
}

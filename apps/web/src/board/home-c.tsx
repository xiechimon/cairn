import { ChevronDown } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { ChiefConversation } from '../chief/chief-conversation.js';
import { ChiefQuestionCard, type ChiefQuestionItem } from '../chief/chief-question-card.js';
import type { ChiefSurface } from '../chief/use-chief-surface.js';
import { Greeting } from '../components/stream/greeting.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { ThreadCard } from '../components/thread/thread-card.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import type { ChiefStreamItem, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { relativeTime } from './rel-time.js';
import { threadHref, threadStatus } from './sidebar-threads.js';
import { threadCopy, threadTone } from './thread-copy.js';

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

const STARTERS = ['做个计划', '接一个仓库', '接着最近的活', '用我的工具'] as const;

const ACT_ORDER = ['needs-you', 'failed', 'review'] as const;

type NeedsYouEntry =
  | { kind: 'question'; key: string; item: ChiefQuestionItem }
  | { kind: 'thread'; key: string; todo: TodoRecord; status: string };

export function streamForProject(
  stream: readonly ChiefStreamItem[],
  projectId: string | null,
): ChiefStreamItem[] {
  if (projectId === null) return [...stream];
  let turn: string | null = null;
  return stream.filter((item) => {
    if (item.kind === 'user') turn = item.projectId ?? null;
    return turn === projectId;
  });
}

function actRank(todo: TodoRecord): number {
  if (todo.awaitingReply === true || todo.phase === 'confirm') return 0;
  if (todo.phase === 'failed') return 1;
  return 2;
}

function needsYouThreads(todos: readonly TodoRecord[]): TodoRecord[] {
  return todos
    .filter((todo) => {
      const status = threadStatus(todo);
      return (status === 'needs-you' || status === 'failed') && todo.snoozeMode == null;
    })
    .sort((a, b) => actRank(a) - actRank(b) || b.phaseAt - a.phaseAt);
}

function SectionHead({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="m-0 font-heading text-ui font-semibold text-foreground">{children}</h3>
      <span className="text-meta text-content-tertiary tabular-nums">{count}</span>
    </div>
  );
}

interface HomeCProps {
  surface: ChiefSurface;
  todos: readonly TodoRecord[];
  now: number;
  projectId: string | null;
  projectName: string | null;
  banner?: ReactNode;
}

export function HomeC({ surface, todos, now, projectId, projectName, banner }: HomeCProps) {
  const { t, locale } = useI18n();
  const { user, live } = useLiveData();
  const navigate = useNavigate();
  const [allOpen, setAllOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const { chiefData } = surface;
  const scoped = useMemo(
    () => todos.filter((todo) => projectId === null || todo.projectId === projectId),
    [todos, projectId],
  );
  const stream = useMemo(
    () => streamForProject(chiefData.stream ?? [], projectId),
    [chiefData.stream, projectId],
  );
  const questions = stream.filter(
    (item): item is ChiefQuestionItem => item.kind === 'question' && item.status === 'pending',
  );
  const conversation = stream.filter(
    (item) => !(item.kind === 'question' && item.status === 'pending'),
  );
  const entries: NeedsYouEntry[] = [
    ...questions.map((item) => ({
      kind: 'question' as const,
      key: item.requestId,
      item,
    })),
    ...needsYouThreads(scoped).map((todo) => ({
      kind: 'thread' as const,
      key: todo.id,
      todo,
      status: ACT_ORDER[actRank(todo)] ?? 'needs-you',
    })),
  ];
  const running = scoped.filter((todo) => threadStatus(todo) === 'running');
  const shown = allOpen ? entries : entries.slice(0, 1);

  const greeting = (
    <Greeting as="h2">
      {t('{greeting}，{name}', {
        greeting: t(greetingFor(new Date(now).getHours())),
        name: user.displayName,
      })}
    </Greeting>
  );
  const since = (
    <p data-testid="home-c-since" className="m-0 mt-0.5 text-meta text-content-tertiary">
      {[
        new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
          month: 'long',
          day: 'numeric',
          weekday: 'short',
        }).format(now),
        t('{n} 项待你处理', { n: entries.length }),
        t('{n} 件在进行', { n: running.length }),
      ].join(' · ')}
    </p>
  );

  const needsYou = entries.length > 0 && (
    <section
      data-testid="needs-you"
      aria-label={t('待你决定')}
      className="mt-6 flex flex-col gap-3"
    >
      <SectionHead count={entries.length}>{t('待你决定')}</SectionHead>
      {shown.map((entry) => (
        <div
          key={entry.key}
          data-slot="needs-you-item"
          data-status={entry.kind === 'question' ? 'question' : entry.status}
        >
          {entry.kind === 'question' ? (
            <ChiefQuestionCard
              item={entry.item}
              onAnswer={surface.onAnswerQuestion}
              onCancel={surface.onCancelQuestion}
            />
          ) : (
            <ThreadCard
              title={entry.todo.title}
              tone={threadTone(entry.todo)}
              stateLabel={t(threadCopy(entry.todo).state)}
              reason={t(threadCopy(entry.todo).reason)}
              {...(threadCopy(entry.todo).primary != null
                ? {
                    primaryLabel: t(threadCopy(entry.todo).primary ?? ''),
                    onPrimary: () => navigate(threadHref(entry.todo.id)),
                  }
                : {})}
              viewLabel={t('查看 thread')}
              onView={() => navigate(threadHref(entry.todo.id))}
            />
          )}
        </div>
      ))}
      {entries.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAllOpen(!allOpen)}
          className="-ml-2.5 self-start text-meta text-content-tertiary hover:text-foreground"
        >
          {allOpen ? t('收起') : t('还有 {n} 件', { n: entries.length - 1 })}
        </Button>
      )}
    </section>
  );

  const hero = (
    <header
      data-testid="home-c-hero"
      className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-[6vh]"
    >
      {greeting}
      {since}
      {needsYou}
      {entries.length === 0 && (
        <div data-testid="home-c-starters" className="mt-4 -ml-2.5 flex flex-wrap gap-1">
          {STARTERS.map((label) => (
            <SuggestionChip
              key={label}
              onClick={() => setPrefill({ text: t(label), key: Date.now() })}
            >
              {t(label)}
            </SuggestionChip>
          ))}
        </div>
      )}
    </header>
  );

  const lead = (
    <section data-testid="home-c-lead" aria-label={t('首页概况')} className="pt-6 pb-8">
      {greeting}
      {since}
      {needsYou}
    </section>
  );

  const pill = running.length > 0 && (
    <div className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-182 flex-col">
      <Button
        variant="ghost"
        data-testid="in-progress-pill"
        aria-expanded={runningOpen}
        onClick={() => setRunningOpen(!runningOpen)}
        className="h-7 gap-2 self-start rounded-full bg-card px-3 text-meta font-normal text-content-secondary shadow-(--e1) hover:bg-card hover:text-foreground dark:hover:bg-card"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-running" />
        {t('{n} 件在进行', { n: running.length })}
        <ChevronDown aria-hidden="true" className={runningOpen ? 'size-3 rotate-180' : 'size-3'} />
      </Button>
      {runningOpen && (
        <div data-testid="in-progress-list" className="mt-2 flex max-h-60 flex-col overflow-y-auto">
          {running.map((todo) => (
            <ThreadRow
              key={todo.id}
              title={todo.title}
              tone="working"
              reason={t(threadCopy(todo).reason)}
              age={relativeTime(todo.phaseAt, now, t)}
              onOpen={() => navigate(threadHref(todo.id))}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section
      data-testid="home-c"
      aria-label={t('与 Coordinator 的对话')}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {banner != null && (
        <div className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-3">{banner}</div>
      )}
      <MessageScrollerProvider defaultScrollPosition="end">
        <ChiefConversation
          variant="global"
          chief={{ ...chiefData, stream: conversation, examples: undefined }}
          onSend={
            surface.onSend != null
              ? (text: string) => surface.onSend?.(text, projectId)
              : live
                ? undefined
                : () => Promise.resolve()
          }
          onRewind={surface.onRewind}
          onAnswerQuestion={surface.onAnswerQuestion}
          onCancelQuestion={surface.onCancelQuestion}
          onWithdraw={surface.onWithdraw}
          onSteer={surface.onSteer}
          onStop={surface.onStop}
          onSettings={() => surface.setChiefView('settings')}
          threadsOpen={false}
          setThreadsOpen={() => {}}
          hero={hero}
          lead={lead}
          prefill={prefill}
          placeholder={
            projectName != null
              ? t('跟 Coordinator 说（在 {name} 里）…', { name: projectName })
              : t('跟 Coordinator 说点什么，或描述一个新任务…')
          }
          aboveComposer={pill}
        />
      </MessageScrollerProvider>
    </section>
  );
}

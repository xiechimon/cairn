import { ChevronDown, FolderOpen, MessageSquareWarning, Settings2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { ChiefConversation } from '../chief/chief-conversation.js';
import { ChiefQuestionCard, type ChiefQuestionItem } from '../chief/chief-question-card.js';
import type { ChiefSurface } from '../chief/use-chief-surface.js';
import { EmptyState } from '../components/empty-state.js';
import { Greeting } from '../components/stream/greeting.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { TextureSkeleton } from '../components/texture/texture.js';
import { ThreadCard } from '../components/thread/thread-card.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import type { ChiefStreamItem, MachineRow, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ClaudeLoginBanner } from './claude-login-banner.js';
import { ACT_ORDER, actRank, needsYouThreads, pendingQuestions } from './needs-you.js';
import { composeRequest } from './open-composer.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadHref, threadStatus, threadTone } from './thread-copy.js';

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

type NeedsYouEntry =
  | { kind: 'question'; key: string; item: ChiefQuestionItem }
  | { kind: 'thread'; key: string; todo: TodoRecord; status: string };

export function streamForProject(
  stream: readonly ChiefStreamItem[],
  projectId: string | null,
): ChiefStreamItem[] {
  if (projectId === null) return [...stream];
  const ownProject = (item: ChiefStreamItem) => ('projectId' in item ? item.projectId : undefined);
  if (!stream.some((item) => ownProject(item) !== undefined)) return [...stream];
  let turn: string | null = null;
  return stream.filter((item) => {
    const own = ownProject(item);
    if (item.kind === 'user') turn = own ?? null;
    const project = own !== undefined ? own : turn;
    return (
      project === projectId ||
      (project === null && item.kind === 'question' && item.status === 'pending')
    );
  });
}

function SectionHead({
  children,
  count,
  countTestId,
}: {
  children: ReactNode;
  count: number;
  countTestId?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="m-0 font-heading text-ui font-semibold text-foreground">{children}</h3>
      <span data-testid={countTestId} className="text-meta text-content-tertiary tabular-nums">
        {count}
      </span>
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
  machines?: readonly MachineRow[];
}

export function HomeC({
  surface,
  todos,
  now,
  projectId,
  projectName,
  banner,
  machines,
}: HomeCProps) {
  const { t, locale } = useI18n();
  const { user, live } = useLiveData();
  const navigate = useNavigate();
  const location = useLocation();
  const composeAt = composeRequest(location.state);
  const [allOpen, setAllOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const { chiefData, chiefView, setChiefView } = surface;
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (chiefView !== 'drawer') return;
    setChiefView('none');
    composerRef.current?.focus({ preventScroll: true });
  }, [chiefView, setChiefView]);
  const loaded = surface.load === 'ready';
  useEffect(() => {
    if (composeAt === null || !loaded) return;
    composerRef.current?.focus({ preventScroll: true });
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
  }, [composeAt, loaded, navigate, location.pathname, location.search]);
  const scoped = useMemo(
    () => todos.filter((todo) => projectId === null || todo.projectId === projectId),
    [todos, projectId],
  );
  const stream = useMemo(
    () => streamForProject(chiefData.stream ?? [], projectId),
    [chiefData.stream, projectId],
  );
  const questions = pendingQuestions(stream);
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
  const running = scoped.filter(
    (todo) => threadStatus(todo) === 'running' && todo.archivedAt == null,
  );
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
        ...(entries.length > 0 ? [t('{n} 项待你处理', { n: entries.length })] : []),
        ...(running.length > 0 ? [t('{n} 件在进行', { n: running.length })] : []),
      ].join(' · ')}
    </p>
  );

  const projectLinks = projectId !== null && (
    <nav
      data-testid="home-c-project-links"
      aria-label={t('项目')}
      className="mt-2 -ml-2.5 flex gap-1"
    >
      <Button
        variant="ghost"
        size="sm"
        className="text-meta text-content-secondary"
        render={<Link to={`/app/project/${projectId}/files`} />}
      >
        <FolderOpen aria-hidden="true" className="size-3.5" />
        {t('文件')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-meta text-content-secondary"
        render={<Link to={`/app/project/${projectId}/settings`} />}
      >
        <Settings2 aria-hidden="true" className="size-3.5" />
        {t('项目设置')}
      </Button>
    </nav>
  );

  const needsYou = entries.length > 0 && (
    <section
      data-testid="needs-you"
      aria-label={t('待你决定')}
      className="mt-6 flex flex-col gap-3"
    >
      <SectionHead count={entries.length} countTestId="needs-you-count">
        {t('待你决定')}
      </SectionHead>
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
          {allOpen ? t('收起其余') : t('还有 {n} 件', { n: entries.length - 1 })}
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
      {projectLinks}
      <ClaudeLoginBanner machines={machines} now={now} />
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
      {projectLinks}
      <ClaudeLoginBanner machines={machines} now={now} />
      {needsYou}
      {chiefData.hasEarlier === true && (
        <p
          data-testid="home-c-earlier"
          className="m-0 mt-8 text-center text-caption text-content-dim"
        >
          {t('往上滑看更早的对话')}
        </p>
      )}
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

  if (surface.load !== 'ready') {
    return (
      <section data-testid="home-c" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {surface.load === 'loading' ? (
          <TextureSkeleton className="mx-auto mt-[12vh] h-40 w-[calc(100%-2rem)] max-w-182" />
        ) : (
          <>
            <div className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-6">
              {projectLinks}
              <ClaudeLoginBanner machines={machines} now={now} />
            </div>
            <EmptyState
              testId="home-c-error"
              icon={MessageSquareWarning}
              title={t('对话加载失败')}
              description={t('对话记录还在，重试一下。')}
              action={{ label: t('重试'), onClick: surface.retry }}
              className="mt-[12vh]"
            />
          </>
        )}
      </section>
    );
  }

  return (
    <section
      data-testid="home-c"
      aria-label={t('与 Coordinator 的对话')}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <h1 className="sr-only">{t('首页')}</h1>
      {banner != null && (
        <div className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-3">{banner}</div>
      )}
      <MessageScrollerProvider defaultScrollPosition="start">
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
          hero={hero}
          lead={lead}
          prefill={prefill}
          placeholder={
            projectName != null
              ? t('跟 Coordinator 说（在 {name} 里）…', { name: projectName })
              : t('跟 Coordinator 说点什么，或描述一个新任务…')
          }
          aboveComposer={pill}
          composerRef={(node) => {
            composerRef.current = node;
          }}
        />
      </MessageScrollerProvider>
    </section>
  );
}

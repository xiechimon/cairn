import { House, ListChecks, MessageSquareWarning, PackageCheck, Settings2 } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { ChiefConversation, ChiefScrollProvider } from '../chief/chief-conversation.js';
import { TaskCardContext } from '../chief/chief-message-rows.js';
import { questionDockState } from '../chief/question-dock-state.js';
import type { ChiefSurface } from '../chief/use-chief-surface.js';
import { ConversationSkeleton } from '../components/conversation-skeleton.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import type { QueryLike } from '../components/query-state.js';
import { Greeting } from '../components/stream/greeting.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { SubtreeErrorBoundary } from '../components/subtree-error-boundary.js';
import { Button } from '../components/ui/button.js';
import type { ChiefStreamItem, MachineRow, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { GitBranch, History, ListLines, Puzzle } from '../icons/index.js';
import { ComposerSetupHint } from './composer-setup-hint.js';
import { ComposerThreadTarget, useComposerThreadTarget } from './composer-thread-target.js';
import { LoadingComposer } from './loading-composer.js';
import { MachineChip, MachinesPanel } from './machines-panel.js';
import { type ComposeState, composeRequest } from './open-composer.js';
import { PhoneTabs } from './phone-tabs.js';
import { TaskCard } from './task-card.js';
import { taskCardFacts } from './task-card-facts.js';
import { TasksPanel } from './tasks-panel.js';
import {
  needsYouBadge,
  type QuestionTarget,
  type QuestionThreadView,
  questionOpenStep,
  scopeTasks,
  type TasksView,
} from './tasks-sections.js';
import { THREAD_PARAM, threadStatus, VIEW_PARAM } from './thread-copy.js';
import { useOpenThread } from './thread-link.js';
import { useNarrow } from './use-narrow.js';
import { PANE_PARAM, paneOf, type WorkPane, WorkPanel } from './work-panel.js';

const CHIEF_PARAM = 'chief';

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

const STARTERS = [
  { label: '做个计划', Icon: ListLines },
  { label: '接一个仓库', Icon: GitBranch },
  { label: '接着最近的活', Icon: History },
  { label: '用我的工具', Icon: Puzzle },
] as const;

const STARTER_CHIP_CLS =
  'h-9 min-h-8 gap-1.5 rounded-full border border-(--border) bg-transparent px-3 hover:border-(--input) [&_svg]:text-(--text-tertiary)';

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

interface HomeCProps {
  surface: ChiefSurface;
  todos: readonly TodoRecord[];
  now: number;
  projectId: string | null;
  projectName: string | null;
  banner?: ReactNode;
  machines?: readonly MachineRow[];
  coordinatorMachineId?: string | null;
  machinesQuery?: QueryLike;
  todosQuery?: QueryLike;
  tasks: TasksView;
  tasksQuery?: QueryLike;
}

function projectHomeSearch(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete('chat');
  return `?${next.toString()}`;
}

function ConversationBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  return (
    <SubtreeErrorBoundary resetKey={resetKey}>
      <ChiefScrollProvider>{children}</ChiefScrollProvider>
    </SubtreeErrorBoundary>
  );
}

export function HomeC({
  surface,
  todos,
  now,
  projectId,
  projectName,
  banner,
  machines,
  coordinatorMachineId = null,
  machinesQuery,
  todosQuery,
  tasks,
  tasksQuery,
}: HomeCProps) {
  const { t, locale } = useI18n();
  const { user, live, teamId, teamsQuery } = useLiveData();
  const navigate = useNavigate();
  const location = useLocation();
  const composeAt = composeRequest(location.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const pane = paneOf(searchParams.get(PANE_PARAM));
  const computers = useMemo(
    () =>
      (machines ?? []).map((machine) =>
        coordinatorMachineId !== null && machine.id === coordinatorMachineId
          ? { ...machine, chiefHost: true }
          : machine,
      ),
    [machines, coordinatorMachineId],
  );
  const threadId = searchParams.get(THREAD_PARAM);
  const conversationResetKey = `${projectId ?? 'coordinator'}:${searchParams.get('chat') ?? ''}:${threadId ?? ''}`;
  const narrow = useNarrow();
  const showPane = (next: WorkPane | null, state: unknown = location.state) => {
    const params = new URLSearchParams(searchParams);
    params.delete(THREAD_PARAM);
    params.delete(VIEW_PARAM);
    if (next === null) params.delete(PANE_PARAM);
    else params.set(PANE_PARAM, next);
    setSearchParams(params, { replace: true, state });
  };
  const togglePane = (next: WorkPane) => {
    showPane(pane === next && threadId === null ? null : next);
  };
  const openThread = useOpenThread();
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const [loadingDraft, setLoadingDraft] = useState('');
  const { chiefData } = surface;
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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
  const conversation = stream.filter(
    (item) => !(item.kind === 'question' && item.status === 'pending'),
  );
  const scopedTasks = useMemo(() => scopeTasks(tasks, projectId), [tasks, projectId]);
  const badge = needsYouBadge(scopedTasks.entries, scopedTasks.questions);
  const taskById = useMemo(
    () => new Map(tasks.entries.map((entry) => [entry.todo.id, entry])),
    [tasks.entries],
  );
  const fullStream = chiefData.stream;
  const renderTaskCard = useCallback(
    (todoId: string) => {
      const entry = taskById.get(todoId);
      if (entry === undefined) return null;
      return (
        <TaskCard
          entry={entry}
          facts={taskCardFacts(fullStream ?? [], todoId)}
          now={now}
          onOpen={() => openThread(todoId)}
        />
      );
    },
    [taskById, fullStream, openThread, now],
  );
  const [questionTarget, setQuestionTarget] = useState<QuestionTarget | null>(null);
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const questionView: QuestionThreadView = {
    threadId: chiefData.threadId ?? null,
    stream: chiefData.stream ?? [],
    hasEarlier: chiefData.hasEarlier === true,
    loadingEarlier: surface.earlier?.loading === true,
    failedEarlier: surface.earlier?.failed === true,
    dismissing: questionDockState.isDismissing,
  };
  const openQuestion = (target: QuestionTarget) => {
    const step = questionOpenStep(target, questionView);
    if (step.kind === 'open-thread') {
      const params = new URLSearchParams(searchParams);
      params.set(CHIEF_PARAM, step.threadId);
      setSearchParams(params, { replace: true, state: location.state });
    }
    setQuestionTarget(target);
  };
  const questionStep =
    questionTarget === null || !loaded ? null : questionOpenStep(questionTarget, questionView);
  const stepKind = questionStep?.kind ?? null;
  const focusAt = questionStep?.kind === 'focus' ? questionStep.at : -1;
  const loadEarlier = surface.earlier?.onLoad;
  useEffect(() => {
    if (questionTarget === null) return;
    if (stepKind === 'focus') {
      questionDockState.setFocus(focusAt);
      if (questionDockState.isCollapsed(questionTarget.requestId))
        questionDockState.toggleCollapsed(questionTarget.requestId);
      setQuestionTarget(null);
    } else if (stepKind === 'load-earlier') {
      loadEarlier?.();
    } else if (stepKind === 'missing') {
      setQuestionTarget(null);
    }
  }, [questionTarget, stepKind, focusAt, loadEarlier]);
  const thread = useComposerThreadTarget(scoped);
  const running = scoped.filter(
    (todo) => threadStatus(todo) === 'running' && todo.archivedAt == null,
  );

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
        ...(badge > 0 ? [t('{n} 项待你处理', { n: badge })] : []),
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
        render={<Link to={{ pathname: '/app', search: projectHomeSearch(searchParams) }} />}
      >
        <House aria-hidden="true" className="size-3.5" />
        {t('项目主页')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-meta text-content-secondary"
        render={<Link to={`/app/project/${projectId}/tasks`} />}
      >
        <ListChecks aria-hidden="true" className="size-3.5" />
        {t('任务')}
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

  const hero = (
    <header
      data-testid="home-c-hero"
      className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-[6vh]"
    >
      {greeting}
      {since}
      {projectLinks}
      {badge === 0 && (
        <div data-testid="home-c-starters" className="mt-4 flex flex-wrap gap-2">
          {STARTERS.map(({ label, Icon }) => (
            <SuggestionChip
              key={label}
              className={STARTER_CHIP_CLS}
              onClick={() => setPrefill({ text: t(label), key: Date.now() })}
            >
              <Icon width={16} height={16} />
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

  const paneButtons = (
    <header
      data-testid="home-c-pane-buttons"
      className="flex h-12 flex-none items-center gap-2 pr-3 pl-5 max-[640px]:pl-14"
    >
      <h1 className="m-0 mr-auto min-w-0 truncate text-ui font-semibold text-foreground">
        {projectName ?? t('Coordinator')}
      </h1>
      {!narrow && (
        <IconTooltip
          label={badge > 0 ? t('任务，{n} 件等你', { n: badge }) : t('任务')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="tasks-toggle"
              aria-pressed={pane === 'tasks' && threadId === null}
              onClick={() => togglePane('tasks')}
              className="relative text-content-tertiary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
            />
          }
        >
          <ListChecks aria-hidden="true" />
          {badge > 0 && (
            <>
              <span
                aria-hidden="true"
                data-slot="needs-you-dot"
                className="absolute top-1 right-1 size-1.5 rounded-full bg-(--card-button)"
              />
              <span data-testid="tasks-badge" className="sr-only">
                {badge}
              </span>
            </>
          )}
        </IconTooltip>
      )}
      <IconTooltip
        label={t('成果')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={pane === 'made' && threadId === null}
            onClick={() => togglePane('made')}
            className="text-content-tertiary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
          />
        }
      >
        <PackageCheck aria-hidden="true" />
      </IconTooltip>
      <MachineChip
        machines={computers}
        open={pane === 'machines' && threadId === null}
        onToggle={() => togglePane('machines')}
        loading={machinesQuery?.isPending === true}
      />
    </header>
  );

  const phoneTabs = narrow && threadId === null && (
    <PhoneTabs tasksOpen={pane === 'tasks'} badge={badge} />
  );

  const workPanel =
    threadId !== null ? null : pane === 'machines' ? (
      <MachinesPanel machines={computers} onClose={() => showPane(null)} query={machinesQuery} />
    ) : pane === 'tasks' ? (
      <TasksPanel
        entries={scopedTasks.entries}
        questions={scopedTasks.questions}
        projectId={projectId}
        now={now}
        onClose={() => showPane(null)}
        onOpenThread={openThread}
        onOpenQuestion={openQuestion}
        onNewTask={() => {
          if (!narrow) composerRef.current?.focus();
          else showPane(null, { compose: Date.now() } satisfies ComposeState);
        }}
        onAddTask={async (text) => {
          if (surface.onSend == null) setPrefill({ text, key: Date.now() });
          else await surface.onSend(text, projectId);
          if (narrow) showPane(null);
        }}
        query={tasksQuery}
      />
    ) : (
      pane !== null && (
        <WorkPanel
          todos={scoped}
          now={now}
          onClose={() => showPane(null)}
          onOpenThread={openThread}
          todosQuery={todosQuery}
        />
      )
    );

  const load =
    live && teamId === undefined
      ? teamsQuery?.isError === true
        ? 'error'
        : 'loading'
      : surface.load;
  const composerPlaceholder =
    projectName != null
      ? t('跟 Coordinator 说（在 {name} 里）…', { name: projectName })
      : t('跟 Coordinator 说点什么，或描述一个新任务…');
  const handedOver = load === 'ready' && loadingDraft !== '';
  useEffect(() => {
    if (!handedOver) return;
    setPrefill({ text: loadingDraft, key: Date.now() });
    setLoadingDraft('');
  }, [handedOver, loadingDraft]);
  if (load !== 'ready') {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <section
            data-testid="home-c"
            className="chat-interactions relative flex min-h-0 min-w-0 flex-1 flex-col overscroll-none"
          >
            {paneButtons}
            {load === 'loading' ? (
              <>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ConversationSkeleton />
                </div>
                <LoadingComposer
                  draft={loadingDraft}
                  onDraftChange={setLoadingDraft}
                  placeholder={composerPlaceholder}
                />
              </>
            ) : (
              <>
                <div className="mx-auto w-[calc(100%-2rem)] max-w-182 flex-none pt-6">
                  {projectLinks}
                </div>
                <EmptyState
                  testId="home-c-error"
                  icon={MessageSquareWarning}
                  title={t('对话加载失败')}
                  description={t('对话记录还在，重试一下。')}
                  action={{
                    label: t('重试'),
                    onClick:
                      teamId === undefined ? () => void teamsQuery?.refetch() : surface.retry,
                  }}
                  className="mt-[12vh]"
                />
              </>
            )}
          </section>
          {workPanel}
        </div>
        {phoneTabs}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <section
          data-testid="home-c"
          aria-label={t('与 Coordinator 的对话')}
          className="chat-interactions relative flex min-h-0 min-w-0 flex-1 flex-col overscroll-none"
        >
          {paneButtons}
          {banner != null && (
            <div className="mx-auto max-h-[40dvh] w-[calc(100%-2rem)] max-w-182 flex-none overflow-y-auto pt-3">
              {banner}
            </div>
          )}
          <TaskCardContext.Provider value={renderTaskCard}>
            <ConversationBoundary resetKey={conversationResetKey}>
              <ChiefConversation
                chief={{ ...chiefData, stream: conversation }}
                onSend={
                  thread.picked !== null
                    ? thread.send
                    : surface.onSend != null
                      ? (text: string) => surface.onSend?.(text, projectId)
                      : live
                        ? undefined
                        : () => Promise.resolve()
                }
                onRewind={surface.onRewind}
                onWithdraw={surface.onWithdraw}
                onSteer={surface.onSteer}
                onStop={surface.onStop}
                earlier={surface.earlier}
                onSettings={() => surface.setChiefView('settings')}
                showBindGate={!live}
                hero={hero}
                lead={lead}
                prefill={prefill}
                placeholder={
                  projectName != null
                    ? t('跟 Coordinator 说（在 {name} 里）…', { name: projectName })
                    : t('跟 Coordinator 说点什么，或描述一个新任务…')
                }
                composerError={thread.error}
                targetPlaceholder={thread.placeholder}
                composerTools={
                  <>
                    <ComposerThreadTarget
                      targets={thread.targets}
                      picked={thread.picked}
                      composerRef={composerRef}
                      onPick={thread.pick}
                    />
                    <ComposerSetupHint />
                  </>
                }
                composerRef={(node) => {
                  composerRef.current = node;
                }}
              />
            </ConversationBoundary>
          </TaskCardContext.Provider>
        </section>
        {workPanel}
      </div>
      {phoneTabs}
    </div>
  );
}

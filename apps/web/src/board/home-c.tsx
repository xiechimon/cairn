import { ListChecks, MessageSquareWarning, PackageCheck } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ChiefConversation, ChiefScrollProvider } from '../chief/chief-conversation.js';
import { QuestionScopeContext } from '../chief/chief-question.js';
import { ChiefStatusMark } from '../chief/chief-status-mark.js';
import { questionDockState } from '../chief/question-dock-state.js';
import { useTouchMessageTools } from '../chief/touch-message-tools.js';
import type { ChiefSurface } from '../chief/use-chief-surface.js';
import { ConversationSkeleton } from '../components/conversation-skeleton.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import type { QueryLike } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Greeting } from '../components/stream/greeting.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { SubtreeErrorBoundary } from '../components/subtree-error-boundary.js';
import { Button } from '../components/ui/button.js';
import type { ChiefStreamItem, MachineRow, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { GitBranch, History, ListLines, Puzzle } from '../icons/index.js';
import {
  ARCHIVED_PROJECT_WRITE_REASON,
  ArchivedProjectBar,
  type ArchivedProjectState,
} from './archived-project-bar.js';
import { ComposerSetupHint } from './composer-setup-hint.js';
import {
  ComposerThreadTarget,
  ComposerThreadTargetMenu,
  useComposerThreadTarget,
} from './composer-thread-target.js';
import {
  FILE_NAME_PARAM,
  FILE_PARAM,
  type FileTarget,
  fileTargetOf,
  OpenFileContext,
  withoutFileTarget,
} from './file-pane.js';
import { FilePreviewPanel } from './file-preview-panel.js';
import { LoadingComposer } from './loading-composer.js';
import { MachineChip, MachinesPanel } from './machines-panel.js';
import { NarrowTopControls, useNarrowChrome } from './narrow-chrome.js';
import { composeRequest } from './open-composer.js';
import { PhoneTabs } from './phone-tabs.js';
import { splitProjectsByArchive } from './project-archive.js';
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
  archived?: ArchivedProjectState | null;
}

export function conversationBoundaryKey(input: {
  projectId: string | null;
  chat: string | null;
  threadId: string | null;
  chiefThreadId: string | null;
}): string {
  return [
    input.projectId ?? 'coordinator',
    input.chat ?? '',
    input.threadId ?? '',
    input.chiefThreadId ?? '',
  ].join(':');
}

function ConversationBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  return (
    <SubtreeErrorBoundary resetKey={resetKey}>
      <ChiefScrollProvider>{children}</ChiefScrollProvider>
    </SubtreeErrorBoundary>
  );
}

function PanelBoundary({
  title,
  phoneTab,
  resetKey,
  onClose,
  children,
}: {
  title: string;
  phoneTab: boolean;
  resetKey: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <SubtreeErrorBoundary
      resetKey={resetKey}
      frame={(fallback) => (
        <SidePanel label={title} onDismiss={onClose} phoneTab={phoneTab} testId="panel-error">
          <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
            <SidePanelTitle>{title}</SidePanelTitle>
          </SidePanelHead>
          {fallback}
        </SidePanel>
      )}
    >
      {children}
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
  archived = null,
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
  const narrow = useNarrow();
  const { createTodo } = useApiMutations(teamId);
  const projectsQuery = useProjects(teamId, live);
  const activeProjects = splitProjectsByArchive(projectsQuery.data ?? []).active;
  const saveProjectId =
    projectId ?? (activeProjects.length === 1 ? (activeProjects[0]?.id ?? null) : null);
  const showPane = (next: WorkPane | null, state: unknown = location.state) => {
    const params = withoutFileTarget(new URLSearchParams(searchParams));
    params.delete(THREAD_PARAM);
    params.delete(VIEW_PARAM);
    if (next === null) params.delete(PANE_PARAM);
    else params.set(PANE_PARAM, next);
    setSearchParams(params, { replace: true, state });
  };
  const fileTarget = pane === 'file' ? fileTargetOf(searchParams) : null;
  const openFile = useCallback(
    (target: FileTarget) =>
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.delete(THREAD_PARAM);
        params.delete(VIEW_PARAM);
        params.set(PANE_PARAM, 'file');
        params.set(FILE_PARAM, target.key);
        params.set(FILE_NAME_PARAM, target.name);
        return params;
      }),
    [setSearchParams],
  );
  const togglePane = (next: WorkPane) => {
    showPane(pane === next && threadId === null ? null : next);
  };
  const openThread = useOpenThread();
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const [loadingDraft, setLoadingDraft] = useState('');
  const { chiefData } = surface;
  const conversationResetKey = conversationBoundaryKey({
    projectId,
    chat: searchParams.get('chat'),
    threadId,
    chiefThreadId: chiefData.threadId ?? null,
  });
  const channelKey = conversationBoundaryKey({
    projectId,
    chat: null,
    threadId: null,
    chiefThreadId: chiefData.threadId ?? null,
  });
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
  const questionScope = useMemo(
    () =>
      projectId === null
        ? null
        : new Set(
            stream.flatMap((item) =>
              item.kind === 'question' && item.status === 'pending' ? [item.requestId] : [],
            ),
          ),
    [stream, projectId],
  );
  const quickOwner = useMemo(() => {
    const full = chiefData.stream ?? [];
    const at = full.findLastIndex((item) => item.kind === 'robot' && item.typing !== true);
    if (at < 0 || full.slice(at).some((item) => item.kind === 'user')) return undefined;
    return full[at];
  }, [chiefData.stream]);
  const quickReplies =
    quickOwner !== undefined && stream.includes(quickOwner) ? chiefData.quickReplies : undefined;
  const scopeQuestions = (node: ReactNode) => (
    <QuestionScopeContext.Provider value={questionScope}>{node}</QuestionScopeContext.Provider>
  );
  const todoGlances = useMemo(
    () =>
      new Map(
        todos.map((todo) => [todo.id, { phase: todo.phase, seq: todo.seqNum, title: todo.title }]),
      ),
    [todos],
  );
  const scopedTasks = useMemo(() => scopeTasks(tasks, projectId), [tasks, projectId]);
  const badge = needsYouBadge(scopedTasks.entries, scopedTasks.questions);
  const [questionTarget, setQuestionTarget] = useState<QuestionTarget | null>(null);
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const questionView: QuestionThreadView = {
    threadId: chiefData.threadId ?? null,
    stream: chiefData.stream ?? [],
    hasEarlier: chiefData.hasEarlier === true,
    loadingEarlier: surface.earlier?.loading === true,
    failedEarlier: surface.earlier?.failed === true,
    dismissing: questionDockState.isDismissing,
    shown: questionScope,
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
      questionDockState.reveal();
      setQuestionTarget(null);
    } else if (stepKind === 'load-earlier') {
      loadEarlier?.();
    } else if (stepKind === 'missing') {
      setQuestionTarget(null);
    }
  }, [questionTarget, stepKind, focusAt, loadEarlier]);
  const [section, setSection] = useState<HTMLElement | null>(null);
  useTouchMessageTools(section);
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

  const hero = (
    <header
      data-testid="home-c-hero"
      className="mx-auto w-[calc(100%-2rem)] max-w-chat flex-none pt-[6vh]"
    >
      {greeting}
      {since}
      {badge === 0 && archived === null && (
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

  const heading = <h1 className="sr-only">{projectName ?? t('Coordinator')}</h1>;
  const paneButtons = narrow ? (
    heading
  ) : (
    <header
      data-testid="home-c-pane-buttons"
      className="relative z-10 flex h-12 flex-none items-center justify-end gap-1 pr-3.5 pl-5 in-data-[chat-top=under-header]:pointer-events-none in-data-[chat-top=under-header]:-mb-12 in-data-[chat-top=under-header]:*:pointer-events-auto"
    >
      {heading}
      <IconTooltip
        label={badge > 0 ? t('任务，{n} 件等你', { n: badge }) : t('任务')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon"
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
              className="absolute top-1 right-1 size-1.75 rounded-full bg-(--count-badge)"
            />
            <span data-testid="tasks-badge" className="sr-only">
              {badge}
            </span>
          </>
        )}
      </IconTooltip>
      <IconTooltip
        label={t('成果')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon"
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
      />
    </header>
  );

  const phoneChrome = narrow && (
    <NarrowChrome
      mark={loaded ? <ChiefStatusMark chief={chiefData} large className="" /> : null}
      pane={pane}
      badge={badge}
      onTasks={() => togglePane('tasks')}
      computers={
        <MachineChip
          round
          machines={computers}
          open={pane === 'machines' && threadId === null}
          onToggle={() => togglePane('machines')}
        />
      }
    />
  );

  const panelBody =
    threadId !== null ? null : pane === 'file' ? (
      fileTarget !== null && (
        <FilePreviewPanel key={fileTarget.key} target={fileTarget} onClose={() => showPane(null)} />
      )
    ) : pane === 'machines' ? (
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
        addBlocked={archived === null ? null : t(ARCHIVED_PROJECT_WRITE_REASON)}
        onAddTask={async (text) => {
          if (live && saveProjectId !== null) {
            await createTodo.mutateAsync({ projectId: saveProjectId, spec: text });
            return 'saved';
          }
          if (surface.onSend == null) setPrefill({ text, key: Date.now() });
          else await surface.onSend(text, projectId);
          if (narrow) showPane(null);
          return 'sent';
        }}
        query={tasksQuery}
      />
    ) : (
      pane !== null && (
        <WorkPanel
          todos={scoped}
          projectId={projectId}
          now={now}
          onClose={() => showPane(null)}
          onOpenThread={openThread}
          todosQuery={todosQuery}
        />
      )
    );
  const workPanel = threadId === null && pane !== null && (
    <PanelBoundary
      title={
        pane === 'file'
          ? (fileTarget?.name ?? '')
          : pane === 'machines'
            ? t('电脑')
            : pane === 'tasks'
              ? t('任务')
              : t('成果')
      }
      phoneTab={pane === 'tasks' || pane === 'made'}
      resetKey={`${pane}:${fileTarget?.key ?? ''}:${projectId ?? ''}`}
      onClose={() => showPane(null)}
    >
      {panelBody}
    </PanelBoundary>
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
      : t('给 Coordinator 发消息');
  const archivedBar =
    archived === null ? null : (
      <ArchivedProjectBar
        state={archived}
        className="mx-auto mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] w-[calc(100%-2rem)] max-w-chat"
      />
    );
  const handedOver = load === 'ready' && loadingDraft !== '';
  useEffect(() => {
    if (!handedOver) return;
    setPrefill({ text: loadingDraft, key: Date.now() });
    setLoadingDraft('');
  }, [handedOver, loadingDraft]);
  if (load !== 'ready') {
    return scopeQuestions(
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
                {archived === null ? (
                  <LoadingComposer
                    draft={loadingDraft}
                    onDraftChange={setLoadingDraft}
                    placeholder={composerPlaceholder}
                  />
                ) : (
                  archivedBar
                )}
              </>
            ) : (
              <EmptyState
                testId="home-c-error"
                icon={MessageSquareWarning}
                title={t('对话加载失败')}
                description={t('对话记录还在，重试一下。')}
                action={{
                  label: t('重试'),
                  onClick: teamId === undefined ? () => void teamsQuery?.refetch() : surface.retry,
                }}
                className="mt-[12vh]"
              />
            )}
          </section>
          {workPanel}
        </div>
        {phoneChrome}
      </div>,
    );
  }

  return scopeQuestions(
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <section
          ref={setSection}
          data-testid="home-c"
          data-chat-top={!narrow && banner == null ? 'under-header' : undefined}
          aria-label={t('与 Coordinator 的对话')}
          className="chat-interactions relative flex min-h-0 min-w-0 flex-1 flex-col overscroll-none"
        >
          {paneButtons}
          {!narrow && <ChiefStatusMark chief={chiefData} />}
          {banner != null && (
            <div
              data-home-banner=""
              className="mx-auto max-h-[40dvh] w-[calc(100%-2rem)] max-w-chat flex-none overflow-y-auto pt-3"
            >
              {banner}
            </div>
          )}
          <OpenFileContext.Provider value={openFile}>
            <ConversationBoundary key={channelKey} resetKey={conversationResetKey}>
              <ChiefConversation
                chief={{
                  ...chiefData,
                  stream: conversation,
                  ...(quickReplies !== undefined ? { quickReplies } : { quickReplies: [] }),
                }}
                onSend={
                  archived !== null
                    ? undefined
                    : thread.picked !== null
                      ? thread.send
                      : surface.onSend != null
                        ? (text: string) => surface.onSend?.(text, projectId)
                        : live
                          ? undefined
                          : () => Promise.resolve()
                }
                onRewind={archived === null ? surface.onRewind : undefined}
                onWithdraw={archived === null ? surface.onWithdraw : undefined}
                onSteer={archived === null ? surface.onSteer : undefined}
                onStop={archived === null ? surface.onStop : undefined}
                composerReplacement={archivedBar}
                earlier={surface.earlier}
                onSettings={() => surface.setChiefView('settings')}
                showBindGate={!live}
                hero={hero}
                todoGlances={todoGlances}
                prefill={prefill}
                placeholder={
                  projectName != null
                    ? t('跟 Coordinator 说（在 {name} 里）…', { name: projectName })
                    : t('给 Coordinator 发消息')
                }
                composerError={thread.error}
                targetPlaceholder={thread.placeholder}
                composerMenu={
                  <ComposerThreadTargetMenu
                    targets={thread.targets}
                    picked={thread.picked}
                    onPick={thread.pick}
                  />
                }
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
          </OpenFileContext.Provider>
        </section>
        {workPanel}
      </div>
      {phoneChrome}
    </div>,
  );
}

function NarrowChrome({
  mark,
  pane,
  badge,
  onTasks,
  computers,
}: {
  mark: ReactNode;
  pane: WorkPane | null;
  badge: number;
  onTasks: () => void;
  computers: ReactNode;
}) {
  const keyboardOpen = useNarrowChrome();
  return (
    <>
      <NarrowTopControls mark={mark} tasksOpen={pane === 'tasks'} badge={badge} onTasks={onTasks} />
      {!keyboardOpen && <PhoneTabs pane={pane} badge={badge} computers={computers} />}
    </>
  );
}

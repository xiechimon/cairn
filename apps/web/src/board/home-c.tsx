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
import { useApiMutations, useProjects, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import {
  CHIEF_DRAFT_STORAGE_KEY,
  ChiefConversation,
  ChiefScrollProvider,
  useMentionGroups,
} from '../chief/chief-conversation.js';
import { QuestionScopeContext } from '../chief/chief-question.js';
import { ChiefStatusMark } from '../chief/chief-status-mark.js';
import { todoGlanceOf } from '../chief/chief-task-refs.js';
import { questionState } from '../chief/question-state.js';
import type { ChiefSurface } from '../chief/use-chief-surface.js';
import { ConversationSkeleton } from '../components/conversation-skeleton.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import type { QueryLike } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { SubtreeErrorBoundary } from '../components/subtree-error-boundary.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import type { ChiefStreamItem, MachineRow, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/hrefs.js';
import {
  ARCHIVED_PROJECT_WRITE_REASON,
  ArchivedProjectBar,
  type ArchivedProjectState,
} from './archived-project-bar.js';
import { useActiveArtifact, useArtifactSplit } from './artifact/artifact-panel.js';
import { useDesignComposer } from './design/design-composer.js';
import { ARTIFACT_NAME_PARAM, ARTIFACT_PARAM } from './file-pane.js';
import { HomeSpiral, type SpiralProject } from './home-spiral.js';
import { LoadingComposer } from './loading-composer.js';
import { MachineChip, MachinesPanel } from './machines-panel.js';
import { MAX_MESSAGE_JUMP_PAGES, MESSAGE_PARAM, messageJumpStep } from './message-jump.js';
import { NarrowTopControls, useNarrowChrome } from './narrow-chrome.js';
import { composeRequest } from './open-composer.js';
import { PhoneTabs } from './phone-tabs.js';
import { splitProjectsByArchive } from './project-archive.js';
import { SetupPrompt, useSetupStep } from './setup-prompt.js';
import { waitingProjectIds } from './sidebar-projects.js';
import { TasksPanel } from './tasks-panel.js';
import {
  needsYouBadge,
  type QuestionTarget,
  type QuestionThreadView,
  questionOpenStep,
  scopeTasks,
  type TasksView,
} from './tasks-sections.js';
import { THREAD_PARAM, VIEW_PARAM } from './thread-copy.js';
import { useCloseThread, useOpenThread } from './thread-link.js';
import { useMediaQuery, useNarrow } from './use-narrow.js';
import { PANE_PARAM, paneOf, TASKS_TAB_PARAM, type WorkPane, WorkPanel } from './work-panel.js';

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

const STARTERS = ['做个计划', '接一个仓库', '接着最近的活'] as const;

export function homeStarters(input: { activeProjects: number; todos: number }): readonly string[] {
  return input.activeProjects === 0 && input.todos === 0
    ? STARTERS.filter((label) => label !== '接着最近的活')
    : STARTERS;
}

export function channelStream(
  stream: readonly ChiefStreamItem[],
  fallback: string,
  fresh: boolean,
  recoverGreeting = false,
): ChiefStreamItem[] {
  if (recoverGreeting || stream.some((item) => item.kind === 'user')) return [...stream];
  const opening = stream.filter((item) => item.kind !== 'error');
  if (opening.length > 0) return opening;
  const failed = opening.length < stream.length;
  return fresh || failed ? [{ kind: 'robot', markdown: fallback, seconds: '' }] : [];
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
  fixtureProjects?: readonly SpiralProject[];
  thread?: ReactNode;
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
  fixtureProjects,
  thread,
}: HomeCProps) {
  const { t } = useI18n();
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
  const docked = thread != null;
  const sendDesignComments =
    archived === null && surface.onSend != null
      ? (ids: readonly string[]) =>
          Promise.resolve(surface.onSend?.(t('按下面的批注改。'), projectId, ids))
      : undefined;
  const designSplit = useArtifactSplit(sendDesignComments);
  const designComposer = useDesignComposer(useActiveArtifact());
  const paneShown = threadId === null || docked;
  const narrow = useNarrow();
  const shortViewport = useMediaQuery('(max-height: 700px)');
  const { createTodo } = useApiMutations(teamId);
  const projectsQuery = useProjects(teamId, live);
  const mentionGroups = useMentionGroups();
  const liveSetupStep = useSetupStep();
  const setupStep = archived === null ? liveSetupStep : null;
  const modelsMissing = setupStep?.next === 'models';
  usePrs(teamId, undefined, live);
  const activeProjects = splitProjectsByArchive(projectsQuery.data ?? []).active;
  const shownProjects = fixtureProjects ?? activeProjects;
  const saveProjectId =
    projectId ?? (activeProjects.length === 1 ? (activeProjects[0]?.id ?? null) : null);
  const showPane = (next: WorkPane | null, state: unknown = location.state) => {
    const params = new URLSearchParams(searchParams);
    params.delete(THREAD_PARAM);
    params.delete(VIEW_PARAM);
    params.delete(TASKS_TAB_PARAM);
    params.delete(ARTIFACT_PARAM);
    params.delete(ARTIFACT_NAME_PARAM);
    if (next === null) params.delete(PANE_PARAM);
    else params.set(PANE_PARAM, next);
    setSearchParams(params, { replace: true, state });
  };
  const togglePane = (next: WorkPane) => {
    showPane(pane === next && paneShown ? null : next);
  };
  const openThread = useOpenThread();
  const closeThread = useCloseThread();
  const [prefill, setPrefill] = useState<{ text: string; key: number; merge?: boolean } | null>(
    null,
  );
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
  const channelGreeting =
    projectName === null
      ? t('{greeting}，{name}。你想让我做什么？', {
          greeting: t(greetingFor(new Date(now).getHours())),
          name: user.displayName,
        })
      : t('{name}，你想在 {project} 里做什么？', { name: user.displayName, project: projectName });
  const stream = useMemo(
    () =>
      archived !== null
        ? (chiefData.stream ?? [])
        : channelStream(
            chiefData.stream ?? [],
            channelGreeting,
            surface.chiefFresh,
            surface.onRetryGreeting !== undefined,
          ),
    [chiefData.stream, archived, channelGreeting, surface.chiefFresh, surface.onRetryGreeting],
  );
  const [only, ...rest] = stream;
  const fallbackOnly =
    only !== undefined && rest.length === 0 && !(chiefData.stream ?? []).includes(only);
  const setupEmpty = modelsMissing && fallbackOnly;
  const conversation = setupEmpty ? [] : stream;
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
  const homeSpiral =
    !narrow && fallbackOnly && !setupEmpty && projectId === null && archived === null;
  const quickReplies = setupEmpty
    ? []
    : fallbackOnly
      ? homeStarters({ activeProjects: shownProjects.length, todos: todos.length }).map((label) =>
          t(label),
        )
      : quickOwner !== undefined && stream.includes(quickOwner)
        ? chiefData.quickReplies
        : undefined;
  const scopeQuestions = (node: ReactNode) => (
    <QuestionScopeContext.Provider value={questionScope}>{node}</QuestionScopeContext.Provider>
  );
  const todoGlances = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todoGlanceOf(todo)])),
    [todos],
  );
  const scopedTasks = useMemo(() => scopeTasks(tasks, projectId), [tasks, projectId]);
  const waitingIds = useMemo(() => waitingProjectIds(tasks), [tasks]);
  const badge = needsYouBadge(scopedTasks.entries, scopedTasks.questions);
  const [questionTarget, setQuestionTarget] = useState<QuestionTarget | null>(null);
  useSyncExternalStore(questionState.subscribe, questionState.snapshot, () => 0);
  const questionView: QuestionThreadView = {
    threadId: chiefData.threadId ?? null,
    stream: chiefData.stream ?? [],
    hasEarlier: chiefData.hasEarlier === true,
    loadingEarlier: surface.earlier?.loading === true,
    failedEarlier: surface.earlier?.failed === true,
    dismissing: questionState.isDismissing,
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
  const focusId = questionStep?.kind === 'focus' ? questionStep.requestId : '';
  const loadEarlier = surface.earlier?.onLoad;
  useEffect(() => {
    if (questionTarget === null) return;
    if (stepKind === 'focus') {
      const id = CSS.escape(focusId);
      document
        .querySelector(
          `[data-testid="chief-stream"] :is([data-request-id="${id}"], [data-reply-source="${id}"])`,
        )
        ?.scrollIntoView({ block: 'center' });
      setQuestionTarget(null);
    } else if (stepKind === 'load-earlier') {
      loadEarlier?.();
    } else if (stepKind === 'missing') {
      setQuestionTarget(null);
    }
  }, [questionTarget, stepKind, focusId, loadEarlier]);

  const jumpMessageId = searchParams.get(MESSAGE_PARAM);
  const jumpRef = useRef<{ target: string | null; threadId: string | null; pagesLoaded: number }>({
    target: null,
    threadId: null,
    pagesLoaded: 0,
  });
  const chiefThreadId = chiefData.threadId ?? null;
  if (jumpRef.current.target !== jumpMessageId || jumpRef.current.threadId !== chiefThreadId) {
    jumpRef.current = { target: jumpMessageId, threadId: chiefThreadId, pagesLoaded: 0 };
  }
  const jumpStep = messageJumpStep(jumpMessageId, {
    loaded: loaded && (!live || chiefThreadId !== null),
    stream: chiefData.stream ?? [],
    hasEarlier: chiefData.hasEarlier === true,
    loadingEarlier: surface.earlier?.loading === true,
    failedEarlier: surface.earlier?.failed === true,
    pagesLoaded: jumpRef.current.pagesLoaded,
  });
  const jumpKind = jumpStep.kind;
  const jumpFocusId = jumpStep.kind === 'focus' ? jumpStep.messageId : '';
  const clearJumpParam = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(MESSAGE_PARAM);
    setSearchParams(next, { replace: true, state: location.state });
  }, [searchParams, setSearchParams, location.state]);
  const handleFocusMessage = useCallback(
    (found: boolean) => {
      if (!found) toastError(t('未能定位到这条消息'), null);
      clearJumpParam();
    },
    [clearJumpParam, t],
  );
  useEffect(() => {
    if (jumpMessageId === null || jumpMessageId === '') return;
    if (jumpKind === 'load-earlier') {
      if (jumpRef.current.pagesLoaded >= MAX_MESSAGE_JUMP_PAGES) return;
      jumpRef.current.pagesLoaded += 1;
      loadEarlier?.();
    } else if (jumpKind === 'missing') {
      toastError(t('未能定位到这条消息'), null);
      clearJumpParam();
    }
  }, [jumpMessageId, jumpKind, loadEarlier, clearJumpParam, t]);

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
            aria-pressed={pane === 'tasks' && paneShown}
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
      mark={loaded ? <ChiefStatusMark chief={{ ...chiefData, stream }} large className="" /> : null}
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

  const panelBody = !paneShown ? null : pane === 'machines' ? (
    <MachinesPanel machines={computers} onClose={() => showPane(null)} query={machinesQuery} />
  ) : pane === 'tasks' ? (
    <TasksPanel
      entries={scopedTasks.entries}
      questions={scopedTasks.questions}
      projectId={projectId}
      now={now}
      onClose={() => showPane(null)}
      openThreadId={docked ? threadId : null}
      onOpenThread={(id) => (docked && id === threadId ? closeThread() : openThread(id))}
      onOpenQuestion={openQuestion}
      addBlocked={archived === null ? null : t(ARCHIVED_PROJECT_WRITE_REASON)}
      onAddTask={async (text, machineId) => {
        if (live && saveProjectId !== null) {
          await createTodo.mutateAsync({ projectId: saveProjectId, spec: text, machineId });
          return 'saved';
        }
        if (surface.onSend == null) setPrefill({ text, key: Date.now() });
        else await surface.onSend(text, projectId);
        if (narrow) showPane(null);
        return 'sent';
      }}
      machines={live && saveProjectId !== null ? computers : []}
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
  const workPanel = paneShown && pane !== null && (
    <PanelBoundary
      title={pane === 'machines' ? t('执行机') : pane === 'tasks' ? t('任务') : t('成果')}
      phoneTab={pane === 'tasks' || pane === 'made'}
      resetKey={`${pane}:${projectId ?? ''}`}
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
  const composerPlaceholder = modelsMissing
    ? t('接入模型来源后就能发消息')
    : projectName != null
      ? t('在 {name} 里发消息', { name: projectName })
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
    setPrefill({ text: loadingDraft, key: Date.now(), merge: true });
    setLoadingDraft('');
  }, [handedOver, loadingDraft]);
  if (load !== 'ready') {
    return scopeQuestions(
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <section
            data-testid="home-c"
            className={`chat-interactions relative flex min-h-0 min-w-0 flex-1 flex-col pointer-fine:overscroll-none ${designSplit?.sectionClass ?? ''}`}
          >
            {designSplit?.chatBar}
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
                description={t('对话记录已保留，请重试。')}
                action={{
                  label: t('重试'),
                  onClick: teamId === undefined ? () => void teamsQuery?.refetch() : surface.retry,
                }}
                className="mt-[12vh]"
              />
            )}
          </section>
          {designSplit?.pane ?? thread}
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
          data-testid="home-c"
          data-chat-top={!narrow && banner == null ? 'under-header' : undefined}
          aria-label={t('与 Coordinator 的对话')}
          className={`chat-interactions relative flex min-h-0 min-w-0 flex-1 flex-col pointer-fine:overscroll-none ${designSplit?.sectionClass ?? ''}`}
        >
          {designSplit?.chatBar}
          {paneButtons}
          {!narrow && (
            <ChiefStatusMark
              chief={{ ...chiefData, stream }}
              hiddenWhenIdle={(homeSpiral && !shortViewport) || setupEmpty}
            />
          )}
          {homeSpiral && <HomeSpiral projects={shownProjects} waiting={waitingIds} />}
          {banner != null && (
            <div
              data-home-banner=""
              className="max-h-[40dvh] w-full flex-none overflow-y-auto px-4 pt-3 pb-1"
            >
              <div className="mx-auto w-full max-w-chat">{banner}</div>
            </div>
          )}
          <ConversationBoundary key={channelKey} resetKey={conversationResetKey}>
            <ChiefConversation
              mentionGroups={mentionGroups}
              focusMessageId={jumpKind === 'focus' ? jumpFocusId : null}
              onFocusMessage={handleFocusMessage}
              chief={{
                ...chiefData,
                stream: conversation,
                ...(quickReplies !== undefined ? { quickReplies } : { quickReplies: [] }),
              }}
              onSend={
                archived !== null
                  ? undefined
                  : surface.onSend != null
                    ? (text: string) => surface.onSend?.(text, projectId, designComposer?.ids)
                    : live
                      ? undefined
                      : () => {}
              }
              onRewind={archived === null ? surface.onRewind : undefined}
              onRetryGreeting={archived === null ? surface.onRetryGreeting : undefined}
              onWithdraw={archived === null ? surface.onWithdraw : undefined}
              unsent={archived === null ? surface.unsent : undefined}
              onStop={archived === null ? surface.onStop : undefined}
              composerReplacement={archivedBar}
              pendingComments={archived === null ? designComposer : null}
              earlier={surface.earlier}
              onSettings={() => navigate(COORDINATOR_ROUTING_HREF)}
              showBindGate={!live}
              todoGlances={todoGlances}
              draftScope={projectId === null ? 'chief' : `chief:${projectId}`}
              draftStorageKey={
                projectId === null
                  ? CHIEF_DRAFT_STORAGE_KEY
                  : `${CHIEF_DRAFT_STORAGE_KEY}.${projectId}`
              }
              prefill={prefill}
              placeholder={composerPlaceholder}
              notice={setupStep !== null && <SetupPrompt step={setupStep} empty={setupEmpty} />}
              composerRef={(node) => {
                composerRef.current = node;
              }}
            />
          </ConversationBoundary>
        </section>
        {designSplit?.pane ?? thread}
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

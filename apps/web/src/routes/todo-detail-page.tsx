import { canOrchestrate } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { activityStore } from '../api/activity.js';
import { agentTodoStore } from '../api/agent-todo.js';
import { ApiError } from '../api/client.js';
import {
  useApiMutations,
  useBuild,
  useBuildChanges,
  useBuildUsage,
  useChiefThreads,
  useDocumentDiff,
  useGithubIssueEcho,
  useMachines,
  useMembers,
  useMessages,
  usePlans,
  useProjectBuilds,
  useProjectFiles,
  useProjects,
  useRunHistoryTokens,
  useSearchResults,
  useSkills,
  useSteps,
  useTags,
  useTodo,
  useTodos,
} from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import {
  mapBranchInfo,
  mapDiffFiles,
  mapPlanDiff,
  mapPlanDoc,
  mapPlanVersions,
  mapRunHistory,
  mapTokenUsage,
  mapTranscript,
  mapUsageCost,
  toDisplayTodo,
} from '../api/mappers.js';
import { useAgentAvatarUrlById, useLiveData } from '../api/provider.js';
import { useConversationStream } from '../api/sse.js';
import { AppSidebar } from '../board/app-sidebar.js';
import { ChiefAgentDialog } from '../chief/chief-agent-dialog.js';
import { useChiefRoot } from '../chief/chief-root.js';
import { inflightOrchestrationFor } from '../chief/orchestration-inflight.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { Button } from '../components/ui/button.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { AcceptDialog } from '../detail/accept-dialog.js';
import { Composer } from '../detail/composer.js';
import { DetailHead } from '../detail/dhead.js';
import { DocPane } from '../detail/docpane.js';
import { substantiveChangesOf } from '../detail/empty-commit.js';
import { FreshBlock } from '../detail/fresh-block.js';
import { mergeRejectCopy, useMergeGate } from '../detail/merge-gate.js';
import { RerunDialog, ReusePanel } from '../detail/overlays.js';
import { RejectDialog } from '../detail/reject-dialog.js';
import { ReviewDialog } from '../detail/review-dialog.js';
import { RightPane } from '../detail/right-pane.js';
import { SourceIssueLine } from '../detail/source-issue.js';
import { SpecBlock } from '../detail/spec-block.js';
import { StopConfirmDialog } from '../detail/stop-confirm-dialog.js';
import { buildTaskMeta } from '../detail/task-meta.js';
import { TaskMetaBlock, type TaskMetaFields } from '../detail/task-meta-block.js';
import type { LiveStep } from '../detail/transcript.js';
import { TranscriptColumn, type TranscriptColumnHandle } from '../detail/transcript-column.js';
import { useDetailActions } from '../detail/use-detail-actions.js';
import { type ChainState, useDetailComposer } from '../detail/use-detail-composer.js';
import { UserMenu } from '../detail/user-menu.js';
import { markDeleted, withoutDeleted } from '../fixtures/deletions.js';
import { overlayContent } from '../fixtures/fixtures.js';
import type {
  DetailContent,
  OverlayState,
  PaneView,
  Phase,
  PlanDiffContent,
  TranscriptItem,
} from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import type { MentionGroups } from '../overlay/mention-picker.js';
import type { FileMentionEntry } from '../overlay/mention-token.js';
import { MoreMenu } from '../overlay/more-menu.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';
import { PHASE_UI } from '../phase.js';
import { safeLocalStorage } from '../safe-storage.js';
import { readStoredTheme } from '../theme.js';

const ASSIGN_AGENT_DIALOG_TITLE = '选择执行 Agent';
const ASSIGN_AGENT_REBIND_CONFIRM_COPY = '更换执行 Agent？后续运行将改由 <agent> 执行。';

function chainView(
  detail: DetailContent | undefined,
  chain: ChainState,
  diff: PlanDiffContent | undefined,
) {
  const revision = detail?.revision;
  const transcript: TranscriptItem[] = [...(detail?.transcript ?? [])];
  if (chain === 'streaming' && revision != null) {
    transcript.push(
      { kind: 'user', text: revision.feedback },
      { kind: 'streaming', seconds: revision.streaming.seconds, label: revision.streaming.label },
    );
  }
  if ((chain === 'landed' || chain === 'building') && revision != null) {
    transcript.push({ kind: 'user', text: revision.feedback }, ...revision.landed.transcriptTail);
  }
  if (chain === 'building' && revision != null) {
    transcript.push({ kind: 'streaming', seconds: 1, label: '处理中...' });
  }
  const landed = chain === 'landed' || chain === 'building';
  return {
    phaseOverride:
      chain === 'streaming'
        ? ('planning' as Phase)
        : chain === 'building'
          ? ('building' as Phase)
          : null,
    transcript,
    doc: landed ? revision?.landed.doc : detail?.doc,
    planVersions: landed ? revision?.landed.planVersions : detail?.planVersions,
    planDiff: chain === 'streaming' ? (revision?.planDiff ?? diff) : diff,
  };
}

export function TodoDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { live, teamId, userName } = useLiveData();
  const { t } = useI18n();
  const fixture = resolveScenario(searchParams);
  const { openChiefThread } = useChiefRoot();
  const orchestrateStart = useOrchestrateStart();
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const [paneView, setPaneView] = useState<PaneView>(fixture.ui?.paneView ?? 'doc');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [liveDraft, setLiveDraft] = useState('');
  const search = useSearchState(fixture.ui?.searchOpen === true, fixture.ui?.searchQuery ?? '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const fixtureTodos = withoutDeleted(fixture.todos);

  const todoQ = useTodo(live ? id : undefined, live);
  const todosQ = useTodos(teamId, live);
  const wireTodo = todoQ.data ?? null;
  const buildId = wireTodo?.latestBuildId ?? null;
  const buildQ = useBuild(buildId, live);
  const stepsQ = useSteps(buildId, live);
  const messagesQ = useMessages(buildId, live);
  const plansQ = usePlans(buildId, live);
  const usageQ = useBuildUsage(buildId, live);
  const historyTokens = useRunHistoryTokens(
    wireTodo?.buildHistory.map((e) => e.buildId) ?? [],
    live,
  );
  const machinesQ = useMachines(teamId, live);
  const membersQ = useMembers(teamId, live);
  const filesQ = useProjectFiles(wireTodo?.projectId, live);
  const agentAvatarUrl = useAgentAvatarUrlById();
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const projectBuildsQ = useProjectBuilds(wireTodo?.projectId, live);
  const tagsQ = useTags(wireTodo?.projectId, live);
  const freshTags = useMemo(() => {
    const all = tagsQ.data ?? [];
    return (wireTodo?.tagIds ?? [])
      .map((id) => all.find((tag) => tag.id === id))
      .filter((tag) => tag !== undefined)
      .map(({ id, name, color }) => ({ id, name, color }));
  }, [tagsQ.data, wireTodo?.tagIds]);
  const mutations = useApiMutations(teamId);

  const liveTodos = useMemo(() => (todosQ.data ?? []).map(toDisplayTodo), [todosQ.data]);
  const todos = live ? liveTodos : fixtureTodos;
  const todo = live
    ? wireTodo
      ? toDisplayTodo(wireTodo)
      : todos.find((t) => t.id === id)
    : (fixtureTodos.find((t) => t.id === id) ?? fixtureTodos[0]);

  const [overlay, setOverlay] = useState<OverlayState | null>(fixture.overlay ?? null);
  const [mergeReject, setMergeReject] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setMergeReject(null);
    setRejectError(null);
  }, []);
  const mergeMissing = useMergeGate(live ? (wireTodo?.assignment?.build?.agentId ?? null) : null);
  const [menu, setMenu] = useState<'versions' | 'compare' | undefined>(fixture.detail?.versionMenu);
  const [diff, setDiff] = useState(fixture.detail?.planDiff);
  const [chain, setChain] = useState<ChainState>('idle');
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [planView, setPlanView] = useState(false);
  useEffect(() => {
    setPlanView(false);
  }, [id, buildId]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopQueued, setStopQueued] = useState(false);
  const [stopping, setStopping] = useState(false);

  const phase: Phase = todo?.phase ?? 'todo';
  const donePatchPending =
    mutations.patchTodo.isPending &&
    mutations.patchTodo.variables?.body.phase === 'done' &&
    mutations.patchTodo.variables?.id === todo?.id;
  const showsChanges = phase === 'review' || phase === 'done' || phase === 'failed';
  const changesQ = useBuildChanges(buildId, live && (showsChanges || compareOpen));
  const latestPlan = plansQ.data?.length ? plansQ.data[plansQ.data.length - 1] : null;
  const compareDiffQ = useDocumentDiff(
    compareOpen && latestPlan && latestPlan.version > 1 ? latestPlan.id : null,
    null,
    live,
  );

  const detailMessagesData = messagesQ.data;
  const knownDetailIds = useMemo(
    () => new Set((detailMessagesData?.messages ?? []).map((m) => m.id)),
    [detailMessagesData],
  );
  const liveText = useSyncExternalStore(liveTextStore.subscribe, () =>
    buildId != null ? liveTextStore.getVisible(buildId, knownDetailIds) : '',
  );
  const liveThinking = useSyncExternalStore(liveThinkingStore.subscribe, () =>
    buildId != null ? liveThinkingStore.getVisible(buildId, knownDetailIds) : '',
  );
  useEffect(() => {
    if (buildId != null) {
      liveTextStore.prune(buildId, knownDetailIds);
      liveThinkingStore.prune(buildId, knownDetailIds);
    }
  }, [buildId, knownDetailIds]);
  const activity = useSyncExternalStore(activityStore.subscribe, () =>
    buildId != null ? activityStore.get(buildId) : null,
  );
  const agentTodo = useSyncExternalStore(agentTodoStore.subscribe, () =>
    buildId != null ? agentTodoStore.get(buildId) : null,
  );
  const streamHandlers = useMemo(
    () => ({
      onMessage: () => {
        void invalidateConverged(qc, { queryKey: ['todo', id] });
      },
    }),
    [qc, id],
  );
  useConversationStream(buildId ?? undefined, live, streamHandlers);

  const steps = stepsQ.data ?? [];
  const runningStep = steps.find((s) => s.status === 'claimed' || s.status === 'pending') ?? null;
  const running = runningStep !== null;
  const reviewActive = steps.some(
    (s) => s.kind === 'review' && (s.status === 'claimed' || s.status === 'pending'),
  );
  const verifyActive = steps.some(
    (s) => s.kind === 'verify' && (s.status === 'claimed' || s.status === 'pending'),
  );
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);
  useEffect(() => {
    setStopping(false);
  }, [buildId]);

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const openSurface = document.querySelector(
        '.overlay, [role="dialog"]:not(.chief-drawer), [role="menu"], [role="listbox"]',
      );
      if (openSurface !== null) return;
      const query = searchParams.toString();
      navigate({ pathname: '/app', ...(query === '' ? {} : { search: `?${query}` }) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, searchParams]);

  const machineName = useMemo(
    () => machinesQ.data?.find((m) => steps.some((s) => s.machineId === m.id))?.name ?? null,
    [machinesQ.data, steps],
  );
  const homeMachine = useMemo(() => {
    const agentId =
      wireTodo?.assignment?.build?.agentId ?? wireTodo?.assignment?.plan?.agentId ?? null;
    if (agentId == null) return null;
    const member = (membersQ.data ?? []).find(
      (m) => m.memberType === 'agent' && m.actorId === agentId,
    );
    const homeId = (member?.actor as { machineId?: string | null } | undefined)?.machineId;
    if (homeId == null) return null;
    return machinesQ.data?.find((m) => m.id === homeId) ?? null;
  }, [wireTodo?.assignment, membersQ.data, machinesQ.data]);
  const machineField = machineName ?? homeMachine?.name ?? null;
  const machineWaiting =
    machineName == null && homeMachine != null && !homeMachine.online && phase !== 'closed';

  const liveDetail: DetailContent | undefined = useMemo(() => {
    if (!live || !wireTodo || buildId == null) return undefined;
    return {
      transcript: mapTranscript({
        messages: messagesQ.data?.messages ?? [],
        steps,
        plans: plansQ.data ?? [],
        build: buildQ.data ?? null,
        todo: toDisplayTodo(wireTodo),
        machineName,
        userName,
        liveText,
        liveThinking,
        stopping,
        activity,
        agentTodo,
      }),
      ...(latestPlan ? { doc: mapPlanDoc(latestPlan.content) } : {}),
      ...(changesQ.data
        ? { changes: { files: mapDiffFiles(changesQ.data.files), expanded: changesExpanded } }
        : {}),
      planVersions: mapPlanVersions(plansQ.data ?? []),
    };
  }, [
    live,
    wireTodo,
    buildId,
    machineName,
    steps,
    messagesQ.data,
    plansQ.data,
    buildQ.data,
    userName,
    liveText,
    liveThinking,
    activity,
    agentTodo,
    latestPlan,
    changesQ.data,
    changesExpanded,
    stopping,
  ]);

  const agentModel = useMemo(() => {
    const agentId =
      wireTodo?.assignment?.build?.agentId ?? wireTodo?.assignment?.plan?.agentId ?? null;
    if (agentId == null) return null;
    const member = (membersQ.data ?? []).find(
      (m) => m.memberType === 'agent' && m.actorId === agentId,
    );
    return (member?.actor as { modelId?: string | null } | undefined)?.modelId ?? null;
  }, [wireTodo?.assignment, membersQ.data]);

  const chipAgentId = todo?.agent?.id;
  const chipAgentModel = useMemo(() => {
    if (chipAgentId === undefined) return undefined;
    const actor = (membersQ.data ?? []).find(
      (m) => m.memberType === 'agent' && m.actorId === chipAgentId,
    )?.actor as { modelId?: string | null; thinkingLevel?: string | null } | undefined;
    return actor?.modelId
      ? { modelId: actor.modelId, thinkingLevel: actor.thinkingLevel ?? null }
      : undefined;
  }, [chipAgentId, membersQ.data]);

  const sourceEchoQ = useGithubIssueEcho(
    live ? wireTodo?.id : undefined,
    live && wireTodo?.sourceRef != null,
  );

  const taskMeta = useMemo<TaskMetaFields | null>(
    () =>
      buildTaskMeta({
        live,
        wireTodo,
        buildId,
        build: buildQ.data,
        machineField,
        machineWaiting,
        agentModel,
        usage: usageQ.data,
        sourceEchoTitle: sourceEchoQ.data?.title,
      }),
    [
      live,
      wireTodo,
      buildId,
      buildQ.data,
      machineField,
      machineWaiting,
      agentModel,
      usageQ.data,
      sourceEchoQ.data,
    ],
  );

  const livePlanDiff: PlanDiffContent | undefined =
    compareOpen && compareDiffQ.data
      ? mapPlanDiff({
          ...compareDiffQ.data,
          toContent: plansQ.data?.find((p) => p.version === compareDiffQ.data.toVersion)?.content,
        })
      : undefined;

  const fixtureView = chainView(fixture.detail, chain, diff);
  const view = live
    ? {
        phaseOverride: null as Phase | null,
        transcript: liveDetail?.transcript ?? [],
        doc: liveDetail?.doc,
        planVersions: liveDetail?.planVersions,
        planDiff: livePlanDiff,
      }
    : fixtureView;

  const transcriptColRef = useRef<TranscriptColumnHandle | null>(null);
  const liveStep = useMemo<LiveStep | null>(
    () =>
      runningStep == null
        ? null
        : {
            step:
              runningStep.kind === 'review'
                ? '审核中'
                : runningStep.kind === 'plan'
                  ? '规划中'
                  : '执行中',
            machine: machineName,
          },
    [runningStep, machineName],
  );

  const actions = useDetailActions({
    live,
    todo,
    wireTodo,
    phase,
    buildId,
    steps,
    members: membersQ.data,
    machines: machinesQ.data,
    mutations,
    navigate,
    setOverlay,
    setMoreOpen,
    setAssignOpen,
  });
  const {
    startBuild,
    assignOptions,
    bindAssign,
    canComplete,
    completeTask,
    canClose,
    closeTask,
    reviewAgents,
    reviewDefaultId,
    reviewProducerProvider,
    fanoutAvailable,
  } = actions;
  const { onSend, onAttachment } = useDetailComposer({
    live,
    phase,
    buildId,
    running,
    mutations,
    scrollToEnd: () => transcriptColRef.current?.scrollToEnd(),
    clearDraft: () => setLiveDraft(''),
    chain,
    setChain,
    revisionAvailable: fixture.detail?.revision != null,
  });

  const actionInFlight =
    live && todo != null && canOrchestrate(todo.phase)
      ? inflightOrchestrationFor(chiefThreadsQ.data, todo.seqNum) !== null
      : false;

  if (todo == null) {
    if (!live) return null;
    const err = todoQ.error;
    const state: 'loading' | 'error' | 'not-found' =
      todoQ.isPending || todosQ.isPending
        ? 'loading'
        : err instanceof ApiError && err.status === 404
          ? 'not-found'
          : err != null
            ? 'error'
            : 'not-found';
    return (
      <div
        className="detail-shell flex h-full overflow-hidden bg-(--surface-1)"
        data-route="todo-detail"
      >
        <AppSidebar fixture={fixture} todos={todos} searchPanel={false} />
        <div className={`${SHEET_PANEL} flex-col items-center justify-center`}>
          <div
            className="max-w-105 px-6 text-center"
            data-testid="detail-unavailable"
            data-state={state}
          >
            {state === 'loading' && (
              <p className="m-0 text-ui text-content-tertiary">{t('加载中…')}</p>
            )}
            {state === 'error' && (
              <>
                <h2 className="m-0 text-card-title font-medium text-foreground">
                  {t('任务加载失败')}
                </h2>
                {err instanceof Error && err.message !== '' && (
                  <p className="mt-2 text-meta break-words text-content-tertiary">{err.message}</p>
                )}
              </>
            )}
            {state === 'not-found' && (
              <h2 className="m-0 text-card-title font-medium text-foreground">
                {t('任务不存在或已被删除')}
              </h2>
            )}
            <div className="mt-6 flex items-center justify-center gap-3">
              {state === 'error' && (
                <Button
                  onClick={() => {
                    void todoQ.refetch();
                    void todosQ.refetch();
                  }}
                >
                  {t('重试')}
                </Button>
              )}
              <Button
                variant={state === 'error' ? 'outline' : 'default'}
                onClick={() => navigate('/app')}
              >
                {t('回看板')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const content = live
    ? wireTodo && buildId
      ? {
          token: { ...mapTokenUsage(usageQ.data ?? []), cost: mapUsageCost(wireTodo.usageCost) },
          branch: mapBranchInfo(buildId, steps, machinesQ.data ?? []),
          runs: mapRunHistory(wireTodo, projectBuildsQ.data ?? [], Date.now(), historyTokens),
        }
      : null
    : overlayContent(todo.id);

  const mentionGroups: MentionGroups = live
    ? {
        todo: (todosQ.data ?? []).map((t) => ({
          id: t.id,
          label: `#${t.seqNum} ${t.title}`,
          seq: t.seqNum,
          subtitle: t.phase,
        })),
        agent: (membersQ.data ?? [])
          .filter((m) => m.memberType === 'agent')
          .map((m) => ({
            id: m.actorId,
            label: (m.actor as { displayName?: string } | undefined)?.displayName ?? m.actorId,
            subtitle:
              (m.actor as { description?: string | null } | undefined)?.description ?? undefined,
          })),
        project: (projectsQ.data ?? []).map((p) => ({ id: p.id, label: p.name })),
        skill: (skillsQ.data ?? []).map((s) => ({
          id: s.id,
          label: s.name,
          subtitle: s.description ?? undefined,
        })),
        machine: (machinesQ.data ?? []).map((m) => ({ id: m.id, label: m.name })),
      }
    : {
        todo: fixtureTodos.map((t) => ({
          id: t.id,
          label: `#${t.seqNum} ${t.title}`,
          seq: t.seqNum,
          subtitle: t.phase,
        })),
        agent: (fixture.team?.agents ?? []).map((a) => ({
          id: a.id,
          label: a.displayName,
          subtitle: a.role ?? a.model,
        })),
        project: Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({
          id,
          label: name,
        })),
        skill: (fixture.resources?.skills ?? []).map((s) => ({
          id: s.name,
          label: s.name,
          subtitle: s.description,
        })),
        machine: (fixture.resources?.machines ?? []).map((m) => ({
          id: m.name,
          label: m.name,
        })),
      };
  const mentionFiles: FileMentionEntry[] | undefined = live
    ? (filesQ.data?.files ?? []).map((f) => ({ path: f.path, type: f.type }))
    : undefined;
  const ui = PHASE_UI[phase];
  const detail = live ? liveDetail : fixture.detail;
  const streaming = live ? running : view.transcript.some((item) => item.kind === 'streaming');
  const docMode =
    view.planDiff != null
      ? 'diff'
      : planView
        ? 'plan'
        : phase === 'review' || phase === 'done' || phase === 'failed'
          ? 'changes'
          : 'plan';

  const stepActionFailed =
    mutations.stepAction.isError &&
    (mutations.stepAction.variables?.body.action === 'restart' ||
      mutations.stepAction.variables?.body.action === 'revision');
  const composerReject = !live
    ? null
    : mutations.sendSteer.isError
      ? t('当前没有运行中的会话，消息未送出')
      : stepActionFailed
        ? t('任务状态已变化，消息未送出')
        : null;

  const handlePrimaryAction = () => {
    if (live) {
      if (phase === 'todo') orchestrateStart.orchestrate({ id: todo.id, seqNum: todo.seqNum });
      else if (phase === 'confirm' && buildId)
        mutations.stepAction.mutate({ buildId, body: { action: 'confirm' } });
      else if (phase === 'review') setOverlay({ kind: 'accept' });
      else if (phase === 'failed') setOverlay({ kind: 'rerun' });
      else if (phase === 'done') startBuild(true);
      return;
    }
    if (chain === 'landed' && detail?.revision != null) {
      setChain('building');
      return;
    }
    if (phase === 'review') setOverlay({ kind: 'accept' });
    if (phase === 'failed') setOverlay({ kind: 'rerun' });
  };

  return (
    <div
      className="detail-shell flex h-full overflow-hidden bg-(--surface-1) [--detail-pane-right:488px] max-[816px]:[--detail-pane-right:0px] [&>.board-sidebar]:max-[816px]:hidden"
      data-route="todo-detail"
      data-todo-id={id}
    >
      <AppSidebar
        fixture={fixture}
        todos={todos}
        searchPanel={false}
        onSearch={() => search.setOpen(true)}
      />
      <div
        className={`group/detail-main ${SHEET_PANEL} flex-col max-[816px]:m-0 max-[816px]:rounded-none max-[816px]:after:hidden`}
        data-testid="detail-main"
      >
        <DetailHead
          todo={todo}
          projectName={projectsQ.data?.find((p) => p.id === todo.projectId)?.name}
          agentModel={chipAgentModel}
          phase={live ? phase : (view.phaseOverride ?? todo.phase)}
          onMore={() => setMoreOpen(true)}
          reviewActive={reviewActive}
          verifyActive={verifyActive}
          actionInFlight={actionInFlight}
          onAction={handlePrimaryAction}
          chipPopoverOpen={fixture.ui?.chipPopoverOpen === true}
          onEditAssign={() => setAssignOpen(true)}
          moreButtonRef={moreAnchorRef}
        />
        <div className="relative flex min-h-0 flex-1" data-testid="detail-body">
          <div className="detail-center flex min-w-0 flex-1 flex-col" data-testid="detail-center">
            {live && wireTodo?.sourceKind != null && (
              <SourceIssueLine
                todo={wireTodo}
                onRetry={() =>
                  mutations.retryGithubIssue.mutate(wireTodo.id, {
                    onError: (error) => toastError(t('重试失败，请稍后再试。'), error),
                  })
                }
                retryPending={mutations.retryGithubIssue.isPending}
                onOpenThread={openChiefThread}
              />
            )}
            {detail == null ? (
              <div className="detail-fresh min-h-0 flex-1 overflow-y-auto pb-4">
                <FreshBlock
                  todo={todo}
                  tags={freshTags}
                  action={ui.action}
                  actionInFlight={actionInFlight}
                  onAction={handlePrimaryAction}
                  hasSpec={live && todo.spec.trim() !== ''}
                />
                {live && todo.spec.trim() !== '' && <SpecBlock spec={todo.spec} fresh />}
              </div>
            ) : (
              <TranscriptColumn
                ref={transcriptColRef}
                transcript={view.transcript}
                liveStep={live ? liveStep : null}
                agent={
                  todo.agent
                    ? {
                        displayName: todo.agent.displayName,
                        avatarUrl: agentAvatarUrl.get(todo.agent.id) ?? null,
                      }
                    : null
                }
                onOpenPlan={() => {
                  setPaneView('doc');
                  setPlanView(true);
                }}
                spec={live && todo.spec.trim() !== '' ? todo.spec : undefined}
                autoScroll={live && view.transcript.length > 0}
              />
            )}
            {ui.placeholder != null && (
              <Composer
                placeholder={reviewActive ? t('AI 审核进行中…') : ui.placeholder}
                aiReview={(phase === 'confirm' || phase === 'review') && !todo.awaitingReply}
                streaming={streaming}
                editable={live}
                draft={live ? liveDraft : undefined}
                onDraftChange={live ? setLiveDraft : undefined}
                onAttachment={onAttachment}
                mentionGroups={mentionGroups}
                mentionFiles={mentionFiles}
                onStop={
                  live && buildId
                    ? () => {
                        setStopQueued(false);
                        setStopOpen(true);
                      }
                    : undefined
                }
                onReview={
                  live && (phase === 'confirm' || phase === 'review') && !reviewActive
                    ? () => setOverlay({ kind: 'review' })
                    : undefined
                }
                onSend={onSend}
              />
            )}
          </div>
          {detail != null && (
            <RightPane
              view={paneView}
              onView={setPaneView}
              docLabel={docMode === 'changes' ? '变更' : '方案'}
              content={content}
              buildId={live ? buildId : null}
            >
              <DocPane
                mode={docMode}
                doc={view.doc}
                changes={live ? liveDetail?.changes : detail.changes}
                now={live ? Date.now() : fixture.now}
                planDropdownOpen={fixture.ui?.planDropdownOpen === true}
                onPaneView={setPaneView}
                hasSections={content != null}
                planVersions={view.planVersions}
                versionMenu={menu}
                onVersionMenu={setMenu}
                onCompare={() => {
                  if (live) {
                    setCompareOpen(true);
                    setMenu(undefined);
                    return;
                  }
                  setDiff(detail.compareTarget ?? detail.revision?.landed.planDiff);
                  setMenu(undefined);
                }}
                onBase={() => {
                  if (live) {
                    setCompareOpen(false);
                    setMenu(undefined);
                    return;
                  }
                  setDiff(undefined);
                  setMenu(undefined);
                }}
                planDiff={view.planDiff}
                buildId={live ? buildId : null}
                emptyMeta={
                  taskMeta != null ? <TaskMetaBlock meta={taskMeta} now={Date.now()} /> : undefined
                }
                onToggleExpand={() => {
                  if (live) {
                    setChangesExpanded((v) => !v);
                    return;
                  }
                  setDiff((d) => (d != null ? { ...d, expanded: !d.expanded } : d));
                }}
              />
            </RightPane>
          )}
        </div>
        {ui.placeholder != null && composerReject != null && (
          <div className="composer-reject absolute bottom-26 left-4 right-[calc(var(--detail-pane-right)+16px)] text-center text-meta text-destructive">
            {composerReject}
          </div>
        )}
      </div>
      {!live && detail?.userMenuOpen === true && (
        <UserMenu theme={readStoredTheme(safeLocalStorage())} />
      )}
      <MoreMenu
        open={moreOpen}
        anchor={moreAnchorRef}
        onClose={() => setMoreOpen(false)}
        onDelete={() => {
          setMoreOpen(false);
          setDeleteOpen(true);
        }}
        onComplete={completeTask}
        canComplete={canComplete}
        onCloseTask={closeTask}
        canClose={canClose}
        onStop={
          live && phase === 'queued' && buildId != null
            ? () => {
                setMoreOpen(false);
                setStopQueued(true);
                setStopOpen(true);
              }
            : undefined
        }
        onReject={
          live && phase === 'review' && buildId != null && !running
            ? () => {
                setMoreOpen(false);
                setOverlay({ kind: 'reject' });
              }
            : undefined
        }
      />
      <DeleteConfirm
        open={deleteOpen}
        title={t('确定删除该任务？此操作不可撤销。')}
        summary={
          <>
            <span className="text-(--text-tertiary)">#{todo.seqNum}</span>
            {todo.title}
          </>
        }
        ariaLabel={t('删除任务')}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          if (live) {
            mutations.deleteTodo.mutate(todo.id, {
              onSuccess: () => navigate('/app'),
              onError: (error) => toastError(t('删除任务失败，请重试。'), error),
            });
            return;
          }
          markDeleted(todo.id);
          navigate('/app');
        }}
      />
      <StopConfirmDialog
        open={stopOpen}
        queued={stopQueued}
        onClose={() => setStopOpen(false)}
        onConfirm={(discard) => {
          setStopOpen(false);
          if (!buildId) return;
          setStopping(true);
          mutations.stopBuild.mutate(
            { buildId, discard },
            {
              onSuccess: (res) => {
                if (!res.delegated) setStopping(false);
              },
              onError: () => setStopping(false),
            },
          );
        }}
      />
      <AcceptDialog
        open={overlay?.kind === 'accept'}
        onClose={closeOverlay}
        missingTools={mergeMissing}
        rejectReason={mergeReject}
        substantiveChanges={live ? substantiveChangesOf(changesQ.data, changesQ.isSuccess) : null}
        mergeLocked={phase === 'failed'}
        infoOutput={wireTodo?.output === 'info'}
        confirming={mutations.mergeBuild.isPending || donePatchPending}
        onConfirm={
          live
            ? (merge) => {
                if (buildId == null || todo == null) {
                  setMergeReject(t('任务数据未就绪，完成请求未送出。请刷新页面后重试。'));
                  return;
                }
                if (!merge) {
                  mutations.patchTodo.mutate(
                    { id: todo.id, body: { phase: 'done' } },
                    {
                      onSuccess: () => {
                        closeOverlay();
                        toastSuccess(t('任务已完成，改动保留在会话分支。'));
                      },
                      onError: (error) =>
                        setMergeReject(mergeRejectCopy(error, t, t('完成请求未送出，请重试。'))),
                    },
                  );
                  return;
                }
                mutations.mergeBuild.mutate(buildId, {
                  onSuccess: () => {
                    closeOverlay();
                    toastSuccess(t('已发起合并，合并完成后任务进入已完成。'));
                  },
                  onError: (error) => setMergeReject(mergeRejectCopy(error, t)),
                });
              }
            : undefined
        }
      />
      <RejectDialog
        open={overlay?.kind === 'reject'}
        onClose={closeOverlay}
        rejectReason={rejectError}
        onConfirm={
          live && buildId
            ? (feedback) => {
                setRejectError(null);
                mutations.stepAction.mutate(
                  {
                    buildId,
                    body: {
                      action: 'revision',
                      side: 'plan',
                      feedback,
                      clientMessageId: crypto.randomUUID(),
                    },
                  },
                  {
                    onSuccess: () => closeOverlay(),
                    onError: (error) =>
                      setRejectError(
                        error instanceof ApiError ? error.message : t('打回请求未送出，请重试。'),
                      ),
                  },
                );
              }
            : undefined
        }
      />
      {overlay?.kind === 'rerun' && (
        <RerunDialog
          reuse={todo.hasPlan}
          onClose={closeOverlay}
          onRerun={
            live
              ? () => {
                  closeOverlay();
                  orchestrateStart.orchestrate({ id: todo.id, seqNum: todo.seqNum });
                }
              : undefined
          }
          onReuse={() => setOverlay({ kind: 'reuse' })}
        />
      )}
      {overlay?.kind === 'reuse' && (
        <ReusePanel
          onClose={closeOverlay}
          onBack={() => setOverlay({ kind: 'rerun' })}
          onView={() => {
            setPlanView(true);
            closeOverlay();
          }}
          onDirect={
            live
              ? () => {
                  startBuild(false);
                }
              : closeOverlay
          }
        />
      )}
      <ChiefAgentDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        agents={assignOptions}
        boundAgentId={todo.agent?.id ?? null}
        onBind={bindAssign}
        title={t(ASSIGN_AGENT_DIALOG_TITLE)}
        confirmCopy={ASSIGN_AGENT_REBIND_CONFIRM_COPY}
      />
      <ReviewDialog
        open={overlay?.kind === 'review'}
        onClose={closeOverlay}
        agents={reviewAgents}
        defaultAgentId={reviewDefaultId ?? undefined}
        producerProvider={reviewProducerProvider}
        fanoutAvailable={live ? fanoutAvailable : undefined}
        onStart={
          live && buildId
            ? (input) => {
                mutations.stepAction.mutate(
                  {
                    buildId,
                    body: {
                      action: 'review',
                      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
                      focus: input.focus,
                    },
                  },
                  { onSuccess: () => closeOverlay() },
                );
              }
            : undefined
        }
      />
      <SearchPanel
        open={search.open}
        fixture={live ? { ...fixture, todos, now: Date.now() } : fixture}
        server={live ? searchResults.data : undefined}
        query={search.query}
        onQuery={search.setQuery}
        onClose={() => search.setOpen(false)}
      />
    </div>
  );
}

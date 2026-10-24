// Todo detail route (issue #56): app shell sidebar + dhead + phase-driven
// body. #366 re-lays the route out as the todos.dev 3-pane grid — 240
// sidebar | fluid thread column | 488 right pane (docs/design/todos.dev.md):
// the 文档|聊天 tab group is gone, the thread (or the fresh block, 23/23d)
// owns the center column with the composer as its only card, and the right
// pane hosts the doc surface (16/17 family) plus the former token/branch/
// history head-icon overlays as static sections (RightPane). #66 adds the
// 更多/删除 overlays; #75 adds the deep dynamic states: the version dropdown /
// compare submenu / plan-version diff surface of the doc pane, the rerun
// dialog + 复用方案 sub-panel (r8 56/74/75) and the interactive reject chain
// (请求修改 → replan streaming → v(N+1) → diff → 确认, AC3) walked
// client-side over the fixture script.
// #83 (M5): live 数据源分支——无 `?scenario=` 时详情页走真 API + 真 SSE
// （transcript 实时流/步进度/plan 版本/变更 diff/overlay 三件），关口动作
// 接真端点（开始/确认/驳回/合并/重跑/删除）；fixture 分支（含 chain 脚本）
// 保持 #56–#75 行为字节不变。
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
import { SearchPanel, useSearchState } from '../overlays/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';
import { PHASE_UI } from '../phase.js';
import { safeLocalStorage } from '../safe-storage.js';
import { readStoredTheme } from '../theme.js';

/** #209 编辑分配弹层文案 [设计](r2 C.18:该弹层内容从未捕获;弹层形态复用
 *  #182 选择 dialog 家族,title/confirmCopy 入参化)。<agent> 占位显示层
 *  替换;i18n 键 = zh 原文。 */
const ASSIGN_AGENT_DIALOG_TITLE = '选择执行 Agent';
const ASSIGN_AGENT_REBIND_CONFIRM_COPY = '更换执行 Agent？后续运行将改由 <agent> 执行。';

/** Reject-chain view derivation (AC3): the streaming round borrows the
 *  planning surface (r8 67), the landed round the confirm surface with
 *  the new version's doc/dropdown, the building round the execution
 *  surface. Kept out of the component so the capture-state render stays
 *  readable. ChainState 类型住 detail/use-detail-composer.ts（#1127）。 */
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
  // ADR 0013 D1/D6/D7 反转：总管面板不再占用 detail-body（testid）右栏格位——
  // 悬浮窗由根 layout 常驻挂载（chief-root.tsx），RightPane 恒在（fresh
  // 态整栏不渲染的 XMON-55 P0 律不动），detail 特例 FAB 位（right 504/
  // bottom 104，为躲 488 右栏而生）随族 FAB 退役。
  // #640：来源面板「总管编排会话」的页内深链改经根 host——set 后由
  // useChiefSurface 的 XMON-106 深链消费机制开窗定位线程（消费即清，
  // 一次性）。
  const { openChiefThread } = useChiefRoot();
  // #640：开始任务单出口——todo 相位主按钮直发总管编排回合（T0 反馈 =
  // toast + 查看会话深链，use-orchestrate-start.ts）。
  const orchestrateStart = useOrchestrateStart();
  // #1216 在飞编排态数据位：与 ChiefRoot 抽屉读面同键去重（零新增流量）。
  const chiefThreadsQ = useChiefThreads(teamId, live);
  // 右 pane 视图 (#366)：doc = DocPane（方案/变更/diff，相位派生），其余三
  // 值 = 原 head 图标 overlay 三件的静止 section。纯渲染态，capture 场景经
  // ui.paneView 冻结（r7 30/31/32、r8 57/77 的新家）。
  const [paneView, setPaneView] = useState<PaneView>(fixture.ui?.paneView ?? 'doc');
  // 更多 menu + delete confirm (#66): confirming a delete marks the todo
  // in the deletions overlay and returns to /app (r2 §5.4) — the board
  // route then renders without it; the fixture phase has no backend.
  // M5: live 模式走 DELETE /api/todos/{id}。
  const [moreOpen, setMoreOpen] = useState(false);
  // #1008：MoreMenu 迁 registry DropdownMenu——触发钮住 dhead、菜单体住本页，
  // 锚 ref 页面层持有双投（DetailHead.moreButtonRef ↔ MoreMenu.anchor）。
  const moreAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // M7 #310 附件 wire：live editable composer 把 draft 提到此处，附件 token
  // 才能注入；send 时与 text 一起随 content 发出（#280 steer / #75 reject）。
  // #729 起 token 注入住 useComposerWire（行原子 + caret 位），本页只保留
  // draft state 与上传委托。
  const [liveDraft, setLiveDraft] = useState('');
  const search = useSearchState(fixture.ui?.searchOpen === true, fixture.ui?.searchQuery ?? '');
  // W4 #286：live 面服务端搜索（fixture 面不经此钩）。
  const searchResults = useSearchResults(search.query, live && search.open);
  const fixtureTodos = withoutDeleted(fixture.todos);

  // —— live 查询面（#83）：todo → latestBuild → steps/messages/plans/changes/
  // usage + machines/members/projects 供 overlay 与指派。fixture 模式全部
  // 惰性（enabled = live）。——
  const todoQ = useTodo(live ? id : undefined, live);
  const todosQ = useTodos(teamId, live);
  const wireTodo = todoQ.data ?? null;
  const buildId = wireTodo?.latestBuildId ?? null;
  const buildQ = useBuild(buildId, live);
  const stepsQ = useSteps(buildId, live);
  const messagesQ = useMessages(buildId, live);
  const plansQ = usePlans(buildId, live);
  const usageQ = useBuildUsage(buildId, live);
  // W4 #288：运行历史 tokens 供数（buildHistory 各 build usage 并查）。
  const historyTokens = useRunHistoryTokens(
    wireTodo?.buildHistory.map((e) => e.buildId) ?? [],
    live,
  );
  const machinesQ = useMachines(teamId, live);
  const membersQ = useMembers(teamId, live);
  // #760 `@` 文件候选：当前项目全仓路径表（失败/非托管/未决 = 空集 →
  // agents-only，渐进增强不挡主面）。
  const filesQ = useProjectFiles(wireTodo?.projectId, live);
  // XMON-105: avatarUrl override join for the todo's agent ref (transcript
  // rows + rerun dialog fallback row).
  const agentAvatarUrl = useAgentAvatarUrlById();
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const projectBuildsQ = useProjectBuilds(wireTodo?.projectId, live);
  // #309 fresh meta 区标签 chip 供数：todo.tagIds × 项目标签集真值投影
  //（r9 100；fixture 面无标签数据源 → 缺省不渲染，r7 23 基线原样）。
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

  // Modal overlays (issue #68, extended in #75 with rerun/reuse): the
  // scenario fixture opens one for capture determinism; the header
  // buttons and the review/failed action buttons open the same set
  // interactively.
  const [overlay, setOverlay] = useState<OverlayState | null>(fixture.overlay ?? null);
  // XMON-89：合并被拒的可见态。住页层而非弹层内——弹层是 retained-mount，
  // 关掉不清会在下一次开窗时回显上一轮的拒绝（并入 closeOverlay）。
  const [mergeReject, setMergeReject] = useState<string | null>(null);
  // #701：打回弹层的服务端拒绝原因（XMON-89 同律——被拒弹层不关、原因显性）。
  const [rejectError, setRejectError] = useState<string | null>(null);
  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setMergeReject(null);
    setRejectError(null);
  }, []);
  // 前置检查（XMON-89）：查的 Agent = merge 步的执行者 = assignment.build 槽
  // （不是卡片上显示的折算值）。
  const mergeMissing = useMergeGate(live ? (wireTodo?.assignment?.build?.agentId ?? null) : null);
  // #75 version-menu + plan-version diff state: scenario-frozen for the
  // captures, interactive afterwards (63–72).
  const [menu, setMenu] = useState<'versions' | 'compare' | undefined>(fixture.detail?.versionMenu);
  const [diff, setDiff] = useState(fixture.detail?.planDiff);
  const [chain, setChain] = useState<ChainState>('idle');
  // live 面:变更 pane 展开态 + 版本对比开关(数据来自 documents/{id}/diff)。
  // XMON-55 P2:默认展开——审核面的全部职责就是让人看 diff,折叠默认把
  // 488px 栏留成空白,复核者每次都得先点一次「全部展开」。收起态仍一键可达
  // (全部收起,同一钮位)。
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  // #318 复用面板「查看方案」:关弹层并把 docpane 切到被复用方案的 plan
  // 显示面(plans 读面已在;原站行为未捕获——r8 §5/r9 §5 登记,本实现为
  // [设计] 裁定)。复位键 = 路由任务 id + 新一轮 build(切换任务/新轮起跑
  // 都回相位默认面;fixture 面 buildId 恒 null,id 是唯一有效键)。
  const [planView, setPlanView] = useState(false);
  useEffect(() => {
    setPlanView(false);
  }, [id, buildId]);
  // #209 编辑分配弹层开态——挂页层:chip popover 关即卸载(dhead
  // OverlayMount),弹层挂其内会被带走。
  const [assignOpen, setAssignOpen] = useState(false);
  // 停止钮（M7 #308，r9 §3.3）：确认弹层开态 + 「正在停止…」过渡旗标——
  // 确认即乐观置位，步终态经 SSE step 事件重取回显（running 转 false）后清。
  const [stopOpen, setStopOpen] = useState(false);
  // #1446：dialog 的 queued 档在打开那一刻定下——开着时机器领走步、卡进
  // planning，标题和丢弃复选行不该在光标下换脸。
  const [stopQueued, setStopQueued] = useState(false);
  const [stopping, setStopping] = useState(false);

  const phase: Phase = todo?.phase ?? 'todo';
  // #1236 不合并完成腿的在飞判据：patchTodo 是多用途写面（指派/钉选/改相），
  // 只有本卡 phase done 的在飞请求才计入 accept 弹层的 confirming 禁用位。
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

  // live transcript：conversation stream 订阅 + text_delta 打字缓冲。
  // #857 收敛交接（chief use-chief-surface 同律）：终稿事件只记 handoff，
  // 读数走 getVisible，落盘走 prune effect——重取在飞时打字面不闪清。
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
  // #905 活动相位读侧（chief use-chief-surface 同律）：单槽快照引用稳定；
  // stepId 对在跑步的过滤在 mapTranscript 内（W1）。
  const activity = useSyncExternalStore(activityStore.subscribe, () =>
    buildId != null ? activityStore.get(buildId) : null,
  );
  const agentTodo = useSyncExternalStore(agentTodoStore.subscribe, () =>
    buildId != null ? agentTodoStore.get(buildId) : null,
  );
  const streamHandlers = useMemo(
    () => ({
      // todo/phase 面由 team stream 驱动失效；此处兜底本页 todo 键。走收敛缝
      // （#717）：挂载取数在飞时到达的提示不得被去重吞掉——chip 停在旧相位
      // 正是 CI 间歇红的历史指纹。
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
  // AI 审核中态（M7 #312，r8 §3.1）：chip 改「审核中」、composer placeholder 改
  // 「AI 审核进行中…」、期间显示停止钮（复用 #308）。判定 = 存在 kind=review
  // 的活动步（claimed/pending）。phase 不动（review 步是额外 agent 步）。
  const reviewActive = steps.some(
    (s) => s.kind === 'review' && (s.status === 'claimed' || s.status === 'pending'),
  );
  // 验证中态（#1250 / ADR 0018 层 1）：同律——存在 kind=verify 的活动步时
  // chip 改「验证中」（dhead 同 review 的覆盖位）；phase 不动（verify 步是
  // 额外 agent 步，合并闸在 verdict 落地后仍留人）。
  const verifyActive = steps.some(
    (s) => s.kind === 'verify' && (s.status === 'claimed' || s.status === 'pending'),
  );
  // 「正在停止…」过渡态出口：活动步消失（stopped 落账/自然收尾）即清；
  // 换 build（重开/重跑）同样复位——新轮不继承上一轮的停止态。
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);
  useEffect(() => {
    setStopping(false);
  }, [buildId]);

  // #634: ESC leaves the detail — layered, never「一按就跳走」. An open
  // floating surface (overlay / dialog / menu / listbox / chip popover) owns
  // the key first: its own listener closes it on the same event while the
  // DOM guard below still sees it mounted, so the exit waits for the next
  // clean ESC. The composer's inline mention state consumes the key with
  // preventDefault (defaultPrevented guard). Only a clean ESC with nothing
  // open goes home, carrying the search string — same law as the back link.
  // ADR 0013 D6/D3 exception: the chief floating window is a persistent
  // root-host [role=dialog] node (keepMounted, hidden when closed) whose own
  // law is "Esc never closes it" — it never owns this key, so the guard
  // excludes the whole window (an open window does not block the detail exit
  // either; it survives the navigation as a cross-route resident). Its inner
  // popovers (thread switcher etc.) portal as separate nodes without the
  // .chief-drawer class and still consume the key first per the layering law.
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

  // 执行机器名（#476 提为单源：transcript stamp 与 meta 块机器行同值）：
  // steps.machineId × machines 读面；未派发 = null。
  const machineName = useMemo(
    () => machinesQ.data?.find((m) => steps.some((s) => s.machineId === m.id))?.name ?? null,
    [machinesQ.data, steps],
  );
  // #1259 归属机（等待面数据源）：步未领（machineName 空时）→ meta 机器行
  // 回落「执行 agent 的归属机」名；归属机离线 = 行尾等待标注（步只等它上
  // 线，归属机闸保证不自动改派）。
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
  // #864 T3：等待标注只在「还在等」时成立。done/failed 会把右栏切到变更面
  // （本块根本不挂），closed 是唯一还能看到本块的收尾相位——失败后被关掉的
  // 任务不该继续自称「等待机器上线」（归属机离线不再是它的阻塞原因，
  // 而 #864 超时收尾后步已经是 failed）。
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

  // #476 meta 块模型行：指派 agent 的 members actor.modelId（#318 副题
  // 同投影），缺指派/缺 actor 退 usage 首行 model（本轮实际运行值）。
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

  // #476 meta 块来源 issue 行的标题真值（ADR 0006 D5：issue 侧为真值）：
  // 与 SourceIssueLine 同查询键（react-query 去重，不多打一次请求）；拉不
  // 到（未连接/限流/已删）退本地标题，行不因此丢失（D6 的隐藏律只约束回
  // 显行自身——meta 行的存在性由本地 sourceRef 决定，echo 只供标题）。
  const sourceEchoQ = useGithubIssueEcho(
    live ? wireTodo?.id : undefined,
    live && wireTodo?.sourceRef != null,
  );

  // #476（#473 决策候选 A）：live 方案空态的任务元信息——投影本体 #1127
  // 收编进 detail/task-meta.ts（纯函数），此处只剩 useMemo 缓存壳；字段序
  // 与缺省律见 task-meta-block.tsx；fixture 面恒 null。
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

  // live 版本对比面（r8 64→65：上一版本 unified diff）。#244：to 版本
  // plan.md 全文挂 fullContent 槽——plans 读面已载各版本 content（05 册
  // M5 §1.2），plan-diff 面「显示完整文件」不走 changes/file 端点。
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

  // #873 会话跟随（#1009 A2 起单源 = registry MessageScroller，手写
  // useChatFollow 与 column-reverse 布局均已退役）：增长只在读者已贴最新端
  // 时拖动视口（原语 autoScroll），读者自己发出去的那条永远跳到最新
  // （列的 imperative handle → scrollToEnd）。
  const transcriptColRef = useRef<TranscriptColumnHandle | null>(null);
  // 在飞行数据（活行披露面 + 会话跟随时机）：步类词表 = 详情头部 chip 同族。
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
            // 真值 = 该步实际领取的机器（machineName 由 steps×machines 解出，
            // 未领取为 null）。不取 machineField：它会回落到 build 钉选的机器
            // ——钉了一台还没来领的机器时，面板会声称「执行机器 = 那台」，
            // 而步其实还在等（钉选等待态在 meta 块另有标注）。
            machine: machineName,
          },
    [runningStep, machineName],
  );

  // #1127：动作簇（开始/指派/完成/关闭/重跑钉选/审核候选）与 composer
  // 发送分流收编进 hooks——detail/use-detail-actions.js 与
  // detail/use-detail-composer.js；逻辑逐字搬移，本页只剩状态与 JSX 装配。
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

  // #1216 在飞编排回合（todo 开始 / failed 重跑 主钮禁用位）：编排落位不写
  // 相位（#640），click→chief 派发之间此前是零标识的静默窗口，实测用户连点
  // 出重复线程（生产库同卡 3–5 条「开始任务 #N」）。判定单源 =
  // chief/orchestration-inflight.ts；其余相位恒 false（confirm/review 等主钮
  // 行为不变，#1216 回归面）。
  const actionInFlight =
    live && todo != null && canOrchestrate(todo.phase)
      ? inflightOrchestrationFor(chiefThreadsQ.data, todo.seqNum) !== null
      : false;

  // #1216：live 详情缺失三态（加载中/加载失败/不存在）——旧 `return null`
  // 把缺失渲染成永久空白壳：无解释、无重试、无回看板，删除入口也够不着
  // （生产实测 failed 卡详情页白屏即此面）。fixture 面保持 null 基线。
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
          token: mapTokenUsage(usageQ.data ?? []),
          branch: mapBranchInfo(buildId, steps, machinesQ.data ?? []),
          runs: mapRunHistory(wireTodo, projectBuildsQ.data ?? [], Date.now(), historyTokens),
        }
      : null
    : overlayContent(todo.id);

  // #311: mention picker groups — live pulls the canonical REST hooks,
  // fixture derives from the local capture set (boardDefault.resources
  // covers machines/skills; projectNames drives the project chip; the
  // team roster gives the agent card row).
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
  // #760 `@` 文件候选：live = 当前项目全仓路径表；fixture 面无仓库 → 缺省
  // （agents-only，DOM 字节不变）。
  const mentionFiles: FileMentionEntry[] | undefined = live
    ? (filesQ.data?.files ?? []).map((f) => ({ path: f.path, type: f.type }))
    : undefined;
  const ui = PHASE_UI[phase];
  const detail = live ? liveDetail : fixture.detail;
  const streaming = live ? running : view.transcript.some((item) => item.kind === 'streaming');
  // The doc pane flips to the 变更 surface once a run produced changes
  // (r7 27/36, r8 54/73); the plan-version diff surface wins while open
  // (r8 65–72); the plan surface serves todo→building (r7 16/17/26).
  // #318 查看方案:planView 强制 plan 面(r8 §5 [设计] 裁定),新 build 复位。
  const docMode =
    view.planDiff != null
      ? 'diff'
      : planView
        ? 'plan'
        : phase === 'review' || phase === 'done' || phase === 'failed'
          ? 'changes'
          : 'plan';

  // composer 被拒提示行（W3 #280 steer / #320 restart / #701 review 打回）：
  // 异步 onSend 失败时 draft 保留不丢字，文案按被拒写面分流；stepAction 错误
  // scope 到 variables.action ∈ {restart, revision}（confirm 主钮同走
  // stepAction，其错误不上此行——review 打回与 confirm 驳回共用 revision 位）。
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

  // The phase's single primary action. Head and fresh-block both call it, so
  // the start affordance sits next to the task brief as well as in the head
  // corner (XMON-55 P0) without forking the ordering rules.
  const handlePrimaryAction = () => {
    if (live) {
      // 主时序关口（02 §4.2；#640 起 todo 开始 = 单出口直发总管编排回合，
      // 不再经 dialog 选择面）：todo 开始 = orchestrate / confirm 确认 /
      // review 验收弹层 / failed 重跑弹层（重跑 = 编排回合 + 复用方案）/
      // done 重开 = 新一轮 build。
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
    // r7 34: the review-phase 完成 button opens the accept dialog;
    // r8 54: the failed 重跑 button opens the rerun dialog（#640 瘦身形）。
    // todo 相位不再开 dialog（#640：开始 = 直发编排，fixture 面 inert）。
    if (phase === 'review') setOverlay({ kind: 'accept' });
    if (phase === 'failed') setOverlay({ kind: 'rerun' });
  };

  return (
    // ADR 0013 D1：#447 (0004 D7) 的 data-chief-open 两态收窄退役——悬浮窗
    // 是覆盖层，右栏格位不再被面板顶掉，--detail-pane-right 收敛回单态
    // 488px（composer-reject 锚照它 calc() 跳过右格位）。#945（detail.css
    // 清零）：三栏壳（240 | fluid | 488，todos.dev 网格）迁 utilities；
    // #932 窄屏折叠走 max-[816px]（288 sidebar 后保留与旧 768/240 同款 ~40px 中栏余量；双定宽栏退场、线程列独占视口，
    // pane 变量归零让锚位停止跳格）。board-sidebar 是 #943 保留的运行时
    // 钩子类，子选择器规则随壳迁移（跨域消费面不断）。Paper PR 7：主栏
    // 坐进与其它路由同一张 SHEET_PANEL；窄屏侧栏隐藏时纸张贴边铺满。
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
            {/* 来源 issue 行（#452 / ADR 0006 D5/D6）：live 专属——未建成给
                重试入口；已建成进入拉一次回显（不一致中性提示、拉不到整行
                隐藏）。fixture 面无来源数据源，不渲染。 */}
            {live && wireTodo?.sourceKind != null && (
              <SourceIssueLine
                todo={wireTodo}
                onRetry={() =>
                  mutations.retryGithubIssue.mutate(wireTodo.id, {
                    // #638：重试再败此前只是 pending 灯灭——toast 点名失败。
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
                  // #612：live 有 spec = 下方简报卡在场，「尚无描述」占位让位
                  // （两行同屏自相矛盾）；fixture 面恒缺省，r7 23 基线不动。
                  hasSpec={live && todo.spec.trim() !== ''}
                />
                {/* M7 #310：live 详情面把用户提交的 spec 渲染在 FreshBlock 之
                    下（fix 丢字 bug ——之前 spec 落 todo.spec 但 UI 从未呈现
                    给用户看）。fixture 面不走此分支：fixture
                    fresh-probe 用同样的「尚无描述」placeholder。 */}
                {live && todo.spec.trim() !== '' && <SpecBlock spec={todo.spec} fresh />}
              </div>
            ) : (
              <TranscriptColumn
                ref={transcriptColRef}
                transcript={view.transcript}
                // #873：活行披露面 = 在跑步（哪一步、哪台机器）——详情面
                // 唯一时间线里没有的事；fixture 面无此数据 = 无面板。
                liveStep={live ? liveStep : null}
                // XMON-105: agent message rows carry the executing
                // agent's own avatar (same identity as board card /
                // team page), never the logged-in user's.
                agent={
                  todo.agent
                    ? {
                        displayName: todo.agent.displayName,
                        avatarUrl: agentAvatarUrl.get(todo.agent.id) ?? null,
                      }
                    : null
                }
                // #366 AC：线程内 plan 卡激活 = 右 pane 切文档面的
                // plan 显示面（与 复用方案「查看方案」同律）。
                onOpenPlan={() => {
                  setPaneView('doc');
                  setPlanView(true);
                }}
                // #827：简报卡住线程列首（随流滚动，不钉住）。fixture 面无
                // spec 数据，捕获字节不动。
                spec={live && todo.spec.trim() !== '' ? todo.spec : undefined}
                // #873 增长跟随的武装位（旧 hook 的 active：live 且有行）。
                autoScroll={live && view.transcript.length > 0}
              />
            )}
            {/* #472：composer 是中心列的最后一个 flex 项（in-flow）——
                滚动区在卡片上缘之上结束，正文永不被压进不透明卡片底下。 */}
            {ui.placeholder != null && (
              <Composer
                placeholder={
                  // AI 审核中态（M7 #312，r8 §3.1）:placeholder 改「AI 审核进行中…」
                  // 与 chip 改「审核中」同步;phase 不动,UI 层覆盖。
                  reviewActive ? t('AI 审核进行中…') : ui.placeholder
                }
                aiReview={
                  // r7 §4.1 / r8 §3.1: the AI 审核 button only shows on writable
                  // confirm/review surfaces; failed and waiting-on-user
                  // composers render the three base tools alone
                  (phase === 'confirm' || phase === 'review') && !todo.awaitingReply
                }
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
                  // AI 审核钮入口（M7 #312，r8 §3.1）：live 确认/审核面可点，fixture
                  // 面不动（DOM 字节不变）。
                  live && (phase === 'confirm' || phase === 'review') && !reviewActive
                    ? () => setOverlay({ kind: 'review' })
                    : undefined
                }
                onSend={onSend}
              />
            )}
          </div>
          {/* ADR 0013 D1：0004 D7 的「竖板与右栏格位互斥」退役——悬浮窗
              盖在右栏之上（覆盖代价由无模态 + ⌘J 即关 + clearance 消化），
              RightPane 恒在。pane 状态（paneView/docMode/diff/menu）全住
              页面层。XMON-55 P0：fresh（无线程）态整栏不渲染——它的三个
              section 都要 build 载荷，文档面在无 build 时也只是空占位；
              488px 让给中心列的任务简报，不让空态各占一半。 */}
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
                  // 上一版本 (r8 64 → 65/71): opens the previous-version
                  // diff — the fixture's compare target, or the chain's
                  // landed diff once the reject loop produced one
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
        {/* ADR 0013 D4/D6：detail 特例 FAB 位与面板拆挂退役——launcher 与
            悬浮窗由根 layout 常驻（chief-root.tsx），#443 的 unreadOnly
            门控在根 host 按路由保留。 */}
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
        // #1446：queued 卡没有 composer，停止钮住更多菜单（停掉等机器的步，
        // 卡回排队前的相位）；其余相位缺省 = 行不渲染。
        onStop={
          live && phase === 'queued' && buildId != null
            ? () => {
                setMoreOpen(false);
                setStopQueued(true);
                setStopOpen(true);
              }
            : undefined
        }
        // #701：审核关口显式打回入口——live review 静息态在场（运行中让位
        // steer 补话面）；fixture 面/其余相位缺省 = 行不渲染，四行几何不变。
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
              // #638：确认层已关（上方 setDeleteOpen），失败 = 任务还在却零解释。
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
          // 乐观过渡态（r9 §3.3「正在停止…」）：确认即置位；终态由 SSE step
          // 事件重取回显（running 转 false 清旗标）。409 竞态（步已收尾）=
          // 数据面已前进，清旗标 + invalidateAll 重取即收敛。
          // delegated:false = 服务端已当场停掉（pending / waiting_quota 步，#1261），
          // 没有在途中断可等；waiting_quota 步不算 running，上面的清旗 effect
          // 不会触发，不清就带到同 build 的下一步（#1446）。
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
        confirming={mutations.mergeBuild.isPending || donePatchPending}
        onConfirm={
          live
            ? (merge) => {
                // #1236 静默 no-op 收口：live 面确认钮恒有真动作——单卡读面
                // 未就位（buildId 缺位）时弹层不关、alert 行点名原因，不再走
                // onClose 静默关闭（生产卡 #44：零请求落库、零反馈）。
                if (buildId == null || todo == null) {
                  setMergeReject(t('任务数据未就绪，完成请求未送出。请刷新页面后重试。'));
                  return;
                }
                if (!merge) {
                  // 不勾 = 完成但不合并（参照产品 r1 §153：complete the todo
                  // and keep the branch as it is）——todo 级改相，与 build 数
                  // 无关；#901 板面 done 落位闸同一写面语义（server 落
                  // DONE_ANNOUNCEMENT 审计行，#902）。
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
                // merge = 202 delegated（r3 §3.6）：合并步机器执行（GitHub 形态
                // 有 PR 时 server 经 GitHub 合并，#1403 段 2b），phase 经 SSE
                // 推进到 done（完成行由 server 落库）。XMON-89：关
                // 弹层改挂 onSuccess——被拒（403/409）时弹层留着显原因，不再
                // 静默关掉；202 到相位推进之间隔着机器执行，toast 是这段窗口
                // 的可见回执（#1236）。
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
          // 打回 = revision 动作面（composer 静息发送同一条 mutation）；关弹层
          // 挂 onSuccess——被拒（409 竞态/相位漂移）弹层留着显原因（XMON-89）。
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
        /* #640：dialog 只剩 failed 重跑面——重跑 = 直发总管编排回合；
           reuse（失败轮持有方案文档）保留 r8 §3.4 复用方案 家族。 */
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
            // #318: 查看方案 = 关弹层 + docpane 切被复用方案的 plan 显示面
            // (plans 读面已在;原站行为未捕获——r8 §5/r9 §5,[设计] 裁定)。
            setPlanView(true);
            closeOverlay();
          }}
          onDirect={
            live
              ? () => {
                  // 复用方案 = 直执行（跳过规划轮，r8 75/76；02 §4.2
                  // withPlan:false 分支）。
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
          // 入队审核步（r8 §3.1 实测）：POST steps {action:"review", agentId?, focus?}
          // → server 入队审核步 + 时间线插 REVIEW_ANNOUNCEMENT + phase 留 confirm
          // /review。#1250：agentId 缺省 = fan-out 三视角（persona 三员各一条）。
          // 乐观 closeOverlay；终态由 SSE step 事件推进 reviewActive。
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

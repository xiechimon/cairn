// Board route (issue #54): app shell = sidebar + board surface, content
// picked by the scenario fixture (issue #52 mechanism). The sidebar is the
// shared AppSidebar (#129): the collapse state (storage-backed, #55 — the
// fixture build injects the key like the theme one), the 用量 row, the
// online dot and the ⌘K row derive identically on every route; this route
// keeps its own SearchPanel because the fixture ui.searchOpen open states
// drive the fixture rows.
// #72: the chief surfaces ride this route — the drawer overlays the board
// (r5 100/111/114/116) and the 总管设置 gear swaps the content area to the
// settings view (r5 101–104). Both open states are fixture-driven; the
// FAB/gear/back/close buttons make them reachable in dev. The
// wake wiring lives in use-chief-surface (#129), shared with every other
// shell family's FAB.
// #83 (M5): live 数据源分支——无 `?scenario=` 时看板走真 API（todos/
// machines/notifications/chief + 新建/开始/拖拽排序/验收合并 mutation），
// fixture 分支保持 #52–#75 行为字节不变（fixture 数据面）。

import type { TodoRecord as WireTodo } from '@pacman/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../api/client.js';
import {
  useApiMutations,
  useBuildChanges,
  useChiefThreads,
  useMachines,
  useProjects,
  useProjectTags,
  useSearchResults,
  useSteps,
  useTodos,
} from '../api/hooks.js';
import { mapBranchInfo, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { AppSidebar } from '../board/app-sidebar.js';
import { type BoardFilters, BoardSurface } from '../board/board.js';
import {
  COLUMN_PARAM,
  COLUMNS,
  isInflightDoneGate,
  parseColumnParam,
  withColumnParam,
} from '../board/columns.js';
import { moveTodo, resetTodoLocal } from '../board/dnd.js';
import { DoneConfirmDialog } from '../board/done-confirm-dialog.js';
import type { FilterChip, FilterDimension } from '../board/filter-panel.js';
import { NotificationBanner, useNotificationBanner } from '../board/notify-banner.js';
// #1261 等额度横幅（todos 集合派生，挂起即显性）。
import { QuotaBanner, quotaBannerInfo } from '../board/quota-banner.js';
import {
  buildRepoOptions,
  matchesProjectFilter,
  parseProjectsParam,
} from '../board/repo-filter.js';
import { ResetConfirmDialog } from '../board/reset-confirm-dialog.js';
import { buildTagOptions, matchesTagFilter, parseTagParam } from '../board/tag-filter.js';
import { useChiefRoot } from '../chief/chief-root.js';
import { ChiefSettings } from '../chief/chief-settings.js';
import { cardOrchestration } from '../chief/orchestration-inflight.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { AcceptDialog } from '../detail/accept-dialog.js';
import { BranchDialog } from '../detail/branch-dialog.js';
import { substantiveChangesOf } from '../detail/empty-commit.js';
import { mergeRejectCopy, useMergeGate } from '../detail/merge-gate.js';
import { withoutDeleted } from '../fixtures/deletions.js';
import { localTodo, overlayContent } from '../fixtures/fixtures.js';
import type { FixtureSet, OverlayState, TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { type NewTaskSurfaceApi, NewTaskSurfaceRoot } from '../overlay/new-task-surface-root.js';
import { SearchPanel, useSearchState } from '../overlays/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';

/** 拖拽提交逐卡发送的字段（#160）：手动改相 + 列内排序位（server
 *  patchTodoBodySchema 两位；首次落位会把触及列的 orderIndex 一次性
 *  归一成列视图序，其后幂等）。 */
interface ReorderPatch {
  phase?: TodoRecord['phase'];
  orderIndex?: number;
}

/** stop-and-done 委托结果（#1247）。泛型不写在 api 调用点：`get` 被 TS 词法
 *  成 GetKeyword（不在 i18n 扫描器的 NO_JSX_AFTER 集），`api.get<T>` 的 `<T>`
 *  会被 i18n-coverage 误判成 JSX 起点、把后文 CJK 注释扫成 jsx-text——本文件
 *  的 api 泛型一律 type alias + `as` 断言。 */
type StopAndDoneResult = { state: 'done' | 'stopping'; todo: WireTodo };

export function BoardPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { search: rawSearch } = useLocation();
  const queryClient = useQueryClient();
  const { live, teamId } = useLiveData();
  const fixture = resolveScenario(searchParams);
  // chief 面（#72/#129 → ADR 0013 D6）：三态视图 + live 数据 wiring 上收到
  // 根 layout 单实例（chief-root.tsx——悬浮窗与 FAB 在那里常驻挂载，
  // `?chief=` 深链消费同批上收）。board 本地只剩设置视图的内容交换态
  // （r5 101–104，D9 承载不变）经 context 消费。
  const { surface: chief } = useChiefRoot();
  const { chiefView, setChiefView, chiefData } = chief;

  // —— live 数据面（#83）：查询 + mutations；fixture 模式全部惰性（enabled
  // = live），采集零请求零流。members/skills/machines 归 #389 抽出的
  // useNewTaskSurface（eager 位保持原状）。——
  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  // #1216 在飞编排态数据位：与 ChiefRoot 的抽屉读面同键去重（零新增流量），
  // SSE step/message 事件失效重取——回合起飞/收尾卡面即时翻转。
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const mutations = useApiMutations(teamId);
  // #640（r14 §5.7）：开始任务 = 单出口直发总管编排回合——board 的两个
  // 入口（卡片 开始 钮 / 拖入执行中）共用；#318 dialog 数据位（机器行 +
  // agent 候选投影）随选择面撤销退役。
  const orchestrateStart = useOrchestrateStart();

  // —— #403/#445/XMON-57 看板筛选面：URL ?tags=（类型轴）与 ?projects=
  // （仓库轴）为唯一真值（刷新/分享不丢），选中集 = 词表名字典序规范序 /
  // 项目 id 字典序规范序。标签数据源：live = 全项目标签集并查
  // （useProjectTags；首载未就绪不激活类型轴，防 tagged 卡闪隐），
  // fixture = scenario.tags。仓库数据源：live = useProjects，
  // fixture = scenario.projectNames；仓库轴零异步依赖——projectId 在卡上，
  // 直达 URL 在项目列表落定前即可正确收窄。
  // XMON-57：类型词表从静态 FIXED_TAGS 换成**作用域内真相**——项目标签集
  // 并集的有序投影（ADR 0005 D2：github 形态词表 = 仓库真实 label 集）。
  // 此前按 FIXED_TAGS 硬渲染 + 按它做白名单，live github 项目的真实 label
  // 既进不了弹层也活不过一次 URL 往返，类型轴对这些项目等于失效。
  const rawTags = searchParams.get('tags');
  const onlyColumn = parseColumnParam(searchParams.get(COLUMN_PARAM));
  const rawProjects = searchParams.get('projects');
  const selectedProjects = useMemo(() => parseProjectsParam(rawProjects), [rawProjects]);
  const selectedProjectSet = useMemo(() => new Set(selectedProjects), [selectedProjects]);
  const projectIds = useMemo(() => (projectsQ.data ?? []).map((p) => p.id), [projectsQ.data]);
  const liveTags = useProjectTags(projectIds, live);
  const fixtureTags = useMemo(() => {
    const rows = fixture.tags ?? [];
    return {
      tagById: new Map(rows.map((tag) => [tag.id, tag] as const)),
      nameById: new Map(rows.map((tag) => [tag.id, tag.name] as const)),
      ordered: rows,
      ready: true,
    };
  }, [fixture]);
  const tagIndex = live ? liveTags : fixtureTags;
  const typeReady = !live || tagIndex.ready;
  // 词表 = 有序投影去重后的名集。未就绪 = null（parseTagParam 据此返回空集，
  // 调用面的 typeReady 闸不激活类型收窄）。去重保序：投影按 projectIds 字典序
  // append，故同名不同色取的是规范序首个项目那行。
  const tagVocab = useMemo(
    () => (typeReady ? [...new Set(tagIndex.ordered.map((tag) => tag.name))] : null),
    [typeReady, tagIndex.ordered],
  );
  const selectedTags = useMemo(() => parseTagParam(rawTags, tagVocab), [rawTags, tagVocab]);
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  // 单轴谓词各自单源（repo-filter.ts / tag-filter.ts），组合谓词只做 AND，
  // 此处不写第二份判定。
  const repoOnly = useCallback(
    (todo: TodoRecord) => matchesProjectFilter(todo, selectedProjectSet),
    [selectedProjectSet],
  );
  const typeOnly = useCallback(
    (todo: TodoRecord) => matchesTagFilter(todo, selectedTagSet, tagIndex.nameById),
    [selectedTagSet, tagIndex.nameById],
  );
  // 组合谓词：仓库 AND 类型；类型轴的就绪闸内嵌（未就绪 = 类型放行，防闪隐）。
  const matchesBoth = useCallback(
    (todo: TodoRecord) => repoOnly(todo) && (typeReady ? typeOnly(todo) : true),
    [repoOnly, typeReady, typeOnly],
  );
  const filterActive = selectedProjects.length > 0 || (selectedTags.length > 0 && typeReady);
  // 选项源（仓库轴）：live = 项目查询序，fixture = scenario.projectNames 书写序。
  const repoSource = useMemo<{ id: string; name: string }[]>(
    () =>
      live
        ? (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name }))
        : Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({ id, name })),
    [live, projectsQ.data, fixture],
  );
  // 写回 = 规范序 join，清空即删参；replace 不刷历史（筛选不是导航步）。
  // 其余参（scenario 等）原样保留——providers-page 着陆参同律。
  // 逗号段手工拼、其余参全权 URLSearchParams：票面要可读的字面逗号
  //（?tags=bug,feature），而 setSearchParams 内部 createSearchParams 会把
  // 逗号重编码成 %2C（react-router 8.4 dom/lib.js useSearchParams 实测）；
  // navigate('?…') 的 parsePath 原样切片 + normalizeSearch 仅做前缀规范化，
  // search 串不重编码，空 pathname = 保当前路径（resolvePath）。词表名是
  // [a-z]+、项目 id 字母数字，无需编码。
  const writeFilterParams = useCallback(
    (tags: string[], projects: string[]) => {
      const rest = new URLSearchParams(searchParams);
      rest.delete('tags');
      rest.delete('projects');
      const parts = [
        rest.toString(),
        tags.length > 0 ? `tags=${tags.join(',')}` : '',
        projects.length > 0 ? `projects=${projects.join(',')}` : '',
      ].filter((s) => s !== '');
      navigate(`?${parts.join('&')}`, { replace: true });
    },
    [searchParams, navigate],
  );
  const toggleTag = useCallback(
    (name: string) => {
      // 规范序 = 字典序：复用 parseTagParam 的规范化（单源，不另写一份
      // 词表序过滤）。词表参必须带上——否则新选的名会被自己的白名单丢掉。
      const next = selectedTags.includes(name)
        ? selectedTags.filter((n) => n !== name)
        : parseTagParam([...selectedTags, name].join(','), tagVocab);
      writeFilterParams(next, selectedProjects);
    },
    [selectedTags, selectedProjects, tagVocab, writeFilterParams],
  );
  const toggleProject = useCallback(
    (id: string) => {
      // 规范序 = 字典序：复用 parseProjectsParam 的规范化（单源）。
      const next = selectedProjects.includes(id)
        ? selectedProjects.filter((p) => p !== id)
        : parseProjectsParam([...selectedProjects, id].join(','));
      writeFilterParams(selectedTags, next);
    },
    [selectedProjects, selectedTags, writeFilterParams],
  );
  // 「仅此」= 把该维度的选集塌成单值（全选后取消一个的镜像操作）。
  const onlyTag = useCallback(
    (name: string) => writeFilterParams([name], selectedProjects),
    [selectedProjects, writeFilterParams],
  );
  const onlyProject = useCallback(
    (id: string) => writeFilterParams(selectedTags, [id]),
    [selectedTags, writeFilterParams],
  );
  const clearTags = useCallback(() => {
    if (selectedTags.length === 0) return;
    writeFilterParams([], selectedProjects);
  }, [selectedTags, selectedProjects, writeFilterParams]);
  const clearProjects = useCallback(() => {
    if (selectedProjects.length === 0) return;
    writeFilterParams(selectedTags, []);
  }, [selectedProjects, selectedTags, writeFilterParams]);
  // 全选 = 写满词表 / 写满项目源。类型轴的「全选」与「无筛选」在命中上等价
  // （无标签卡恒可见，全选后可见集与空选集相同），但写满而非清空——用户按的
  // 是「全选」，读数就该是 6/6 而不是 0/6；等价是语义性质，不是按钮该有的
  // 副作用。
  // 规范序 = 字典序：词表自身是投影序（FIXED_TAGS 表序 / 项目 append 序），
  // 直接写会与 toggle 走的 parseTagParam 规范序不一致——同一选集两种 URL。
  const selectAllTags = useCallback(() => {
    if (tagVocab == null) return;
    writeFilterParams([...tagVocab].sort(), selectedProjects);
  }, [tagVocab, selectedProjects, writeFilterParams]);
  const selectAllProjects = useCallback(() => {
    if (repoSource.length === 0) return;
    writeFilterParams(selectedTags, repoSource.map((project) => project.id).sort());
  }, [repoSource, selectedTags, writeFilterParams]);
  // 反选 = 选集取源集补集（全选行右端键）：空选反选 = 全选、满选反选 = 清空，
  // 与全选行的满选再点同守「清除不丢路径」。规范序同全选 = 字典序。
  const invertTags = useCallback(() => {
    if (tagVocab == null) return;
    const picked = new Set(selectedTags);
    writeFilterParams([...tagVocab].filter((name) => !picked.has(name)).sort(), selectedProjects);
  }, [tagVocab, selectedTags, selectedProjects, writeFilterParams]);
  const invertProjects = useCallback(() => {
    const picked = new Set(selectedProjects);
    writeFilterParams(
      selectedTags,
      repoSource
        .map((project) => project.id)
        .filter((id) => !picked.has(id))
        .sort(),
    );
  }, [repoSource, selectedTags, selectedProjects, writeFilterParams]);
  const clearFilters = useCallback(() => {
    if (selectedProjects.length === 0 && searchParams.get('tags') == null && onlyColumn == null)
      return;
    const rest = new URLSearchParams(searchParams);
    for (const key of ['tags', 'projects', COLUMN_PARAM]) rest.delete(key);
    navigate(`?${rest.toString()}`, { replace: true });
  }, [selectedProjects, searchParams, onlyColumn, navigate]);
  const clearColumn = useCallback(() => {
    navigate({ search: withColumnParam(rawSearch, null) }, { replace: true });
  }, [navigate, rawSearch]);
  const onlyColumnName = COLUMNS.find((c) => c.id === onlyColumn)?.name;

  // New-task dialog (#66): fixture phase has no backend, so a saved task
  // lives in this client-side set — the card lands in 待开始 with the
  // 刚刚 label and the column count couples (r2 §4.2/§5.2). Deletions
  // made on the detail route ride along via the deletions overlay.
  // M5: live 模式下 todos = 查询真值（SSE → invalidate 重取），本地集仅
  // fixture 分支使用。
  const [fixtureTodos, setFixtureTodos] = useState<TodoRecord[]>(() =>
    withoutDeleted(fixture.todos),
  );
  const liveTodos = useMemo(() => (todosQ.data ?? []).map(toDisplayTodo), [todosQ.data]);
  const todos = live ? liveTodos : fixtureTodos;

  // —— XMON-57 筛选面板装配：两轴选项集（含计数）+ 生效筛选条 + 空态摘要。
  // 计数口径 = **另一轴收窄后**的命中卡数——本轴自身的选中不参与，否则勾上
  // 一个选项后其余全变 0，计数就失去导航意义（Multica 的 facet 计数同口径）。
  const repoOptions = useMemo(
    () => buildRepoOptions(repoSource, todos, typeOnly),
    [repoSource, todos, typeOnly],
  );
  const tagOptions = useMemo(
    () => buildTagOptions(tagIndex.ordered, todos, repoOnly, tagIndex.nameById),
    [tagIndex.ordered, todos, repoOnly, tagIndex.nameById],
  );
  // 截断只发生在**读数**上（筛选条 / 空态摘要），选集本身从不截断。
  const summarize = (labels: string[]): string =>
    labels.length <= 2
      ? labels.join(', ')
      : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  const repoLabels = selectedProjects.map(
    (id) => repoOptions.find((option) => option.id === id)?.name ?? id,
  );
  // 生效筛选条：一条一维度，点即清该维度；两轴皆空 = 无条可摘（不画常驻
  // 「全部」pill——那会把「当前无筛选」表达成一个筛选）。类型轴未就绪时
  // 不当生效项（同 filterActive 的就绪闸）。
  const chips: FilterChip[] = [
    ...(onlyColumnName != null
      ? [{ key: 'column', label: t(onlyColumnName), onClear: clearColumn }]
      : []),
    ...(selectedTags.length > 0 && typeReady
      ? [{ key: 'type', label: `${t('类型')} · ${summarize(selectedTags)}`, onClear: clearTags }]
      : []),
    ...(selectedProjects.length > 0
      ? [{ key: 'repo', label: `${t('仓库')} · ${summarize(repoLabels)}`, onClear: clearProjects }]
      : []),
  ];
  // 维度序 = 类型轴在前（#636：参考站的创建者段位由本仓自有 tag 轴取代，用户
  // 点名「替换成我自己的，比如 tag 的筛选」），仓库轴居参考站的项目段位。
  const dimensions: FilterDimension[] = [
    {
      key: 'type',
      name: '类型',
      choices: tagOptions.map((option) => ({
        value: option.name,
        label: option.name,
        color: option.color,
        count: option.count,
      })),
      selected: selectedTags,
      onToggle: toggleTag,
      onSelectAll: selectAllTags,
      onInvert: invertTags,
      onClear: clearTags,
      onOnly: onlyTag,
    },
    {
      key: 'repo',
      name: '仓库',
      choices: repoOptions.map((option) => ({
        value: option.id,
        label: option.name,
        count: option.count,
      })),
      selected: selectedProjects,
      onToggle: toggleProject,
      onSelectAll: selectAllProjects,
      onInvert: invertProjects,
      onClear: clearProjects,
      onOnly: onlyProject,
    },
  ];
  const filters: BoardFilters = {
    dimensions,
    chips,
    totalSelected: selectedProjects.length + selectedTags.length,
    active: filterActive,
    matches: matchesBoth,
    onClear: clearFilters,
    summary: chips.map((chip) => chip.label).join(' · '),
  };
  // 新建任务面（#389）：dialog 接线 = useNewTaskSurface（侧栏全局面共享同一
  // save 路径）；board 特有的只有 fixture 保存落点（本地卡 append，#66 律）
  // 与 eager 数据位。spec 15 #394 同律：参数 = 正文，标题由 localTodo 内
  // shared 规则派生（live 面 = wire 空串 server 派生，agent 回填）。
  const onFixtureSave = useCallback(
    (spec: string) => {
      setFixtureTodos((prev) => [
        ...prev,
        // fixture.now is the session's reference instant, so the fresh
        // card reads 刚刚 against the same clock as the frozen labels.
        // fixture 面 localTodo 保持 canon projectId(approximation,选择
        // 是纯表单 state 无 mutation,#176 票面 live 语义)。
        localTodo(prev.reduce((max, t) => Math.max(max, t.seqNum), 0) + 1, spec, fixture.now),
      ]);
    },
    [fixture],
  );
  // XMON-93 隔离面：dialog 的 open/正文态住进 NewTaskSurfaceRoot 叶子内部，
  // 开合与输入不再整板重渲染（原 useNewTaskSurface 住本页 = ESC 关闭触发
  // 全量卡片同步重渲染，退场动画掉帧）。opener 走 ref 读，引用恒定。
  const newTaskApiRef = useRef<NewTaskSurfaceApi | null>(null);
  const openNewTask = useCallback(() => newTaskApiRef.current?.openDialog(), []);
  // Modal overlays over the board (issue #68): the accept dialog opens from
  // the review card's 完成 button (r7 34) or the scenario fixture; the
  // branch dialog from the card's branch icon.
  const [overlay, setOverlay] = useState<OverlayState | null>(fixture.overlay ?? null);
  const [overlayTodo, setOverlayTodo] = useState<TodoRecord | null>(null);
  // XMON-89：合并被拒的可见态，随弹层关闭一并清（不清会在下次开窗时回显上
  // 一轮的拒绝——弹层是 retained-mount）。
  const [mergeReject, setMergeReject] = useState<string | null>(null);
  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setMergeReject(null);
  }, []);
  // #755 重置确认闸：待确认的落位卡 + dialog 打开时刻的相位/build 快照
  // （confirm 重放竞态的服务端复核位）+ stale 标记（构建在 dialog 打开后
  // 推进了——清单按现记录刷新、弹层不关重新确认）+ 在飞标记。
  const [resetTarget, setResetTarget] = useState<TodoRecord | null>(null);
  const [resetSnapshot, setResetSnapshot] = useState<{
    phase: TodoRecord['phase'];
    buildId: string | null;
  } | null>(null);
  const [resetStale, setResetStale] = useState(false);
  const [resetting, setResetting] = useState(false);
  const openResetGate = useCallback((todo: TodoRecord) => {
    setResetTarget(todo);
    setResetSnapshot({ phase: todo.phase, buildId: todo.latestBuildId });
    setResetStale(false);
  }, []);
  const closeResetGate = useCallback(() => {
    setResetTarget(null);
    setResetSnapshot(null);
    setResetStale(false);
  }, []);
  const confirmReset = useCallback(async () => {
    if (resetTarget == null || resetSnapshot == null) return;
    // fixture 面无后端：dialog 面 parity + 本地重置投影（dnd.ts
    // resetTodoLocal，与 server resetTodo 的 todo 写面逐位对齐）。
    if (!live) {
      setFixtureTodos((prev) => resetTodoLocal(prev, resetTarget.id, fixture.now));
      closeResetGate();
      return;
    }
    setResetting(true);
    try {
      await api.post<TodoRecord>(`/api/todos/${resetTarget.id}/reset`, {
        expectedPhase: resetSnapshot.phase,
        expectedBuildId: resetSnapshot.buildId,
      });
      closeResetGate();
      await queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // 构建在 dialog 打开后推进了：按现记录刷新快照、显 stale 提示，
        // 弹层不关——按新文案重新确认（旧文案作废）。
        await queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
        const record = (error.data as { record?: WireTodo } | null)?.record;
        if (record != null) {
          const display = toDisplayTodo(record);
          setResetTarget(display);
          setResetSnapshot({ phase: display.phase, buildId: display.latestBuildId });
        }
        setResetStale(true);
      } else {
        closeResetGate();
        await queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
        toastError(t('重置任务失败，请重试。'), error);
      }
    } finally {
      setResetting(false);
    }
  }, [resetTarget, resetSnapshot, live, fixture.now, teamId, queryClient, t, closeResetGate]);
  // 前置检查（XMON-89）：查的 Agent = merge 步的执行者 = assignment.build 槽。
  // 从 wire todos 取而不是 overlayTodo（显示投影是 build ?? plan 折算，两槽
  // 分设时与执行者分叉）。
  const overlayWire = useMemo(
    () => (todosQ.data ?? []).find((wire) => wire.id === overlayTodo?.id) ?? null,
    [todosQ.data, overlayTodo],
  );
  const mergeMissing = useMergeGate(
    live ? (overlayWire?.assignment?.build?.agentId ?? null) : null,
  );
  // #1313：完成弹层要知道这份 diff 是不是空提交。只在弹层打开时读 changes。
  const acceptBuildId =
    live && overlay?.kind === 'accept'
      ? (overlayWire?.latestBuildId ?? overlayTodo?.latestBuildId ?? null)
      : null;
  const acceptChangesQ = useBuildChanges(acceptBuildId, acceptBuildId != null);
  const substantiveChanges = substantiveChangesOf(acceptChangesQ.data, acceptChangesQ.isSuccess);
  // #1236 不合并完成腿的在飞判据：patchTodo 是多用途写面（拖拽落位/重置），
  // 只有弹层目标卡的 phase done 在飞请求才计入 confirming 禁用位。
  const donePatchPending =
    mutations.patchTodo.isPending &&
    mutations.patchTodo.variables?.body.phase === 'done' &&
    mutations.patchTodo.variables?.id === overlayTodo?.id;
  const openFor = (todo: TodoRecord, kind: OverlayState['kind']) => {
    setOverlayTodo(todo);
    setOverlay({ kind });
  };
  const search = useSearchState(fixture.ui?.searchOpen === true, fixture.ui?.searchQuery ?? '');
  // W4 #286：live 面服务端搜索（fixture 面不经此钩）。
  const searchResults = useSearchResults(search.query, live && search.open);
  // #114: 看板顶部通知引导条 — live reads the real Notification.permission;
  // fixture scenarios opt in via ui.notificationBanner (fixture determinism,
  // the r7 baselines carry no banner)
  const notifyBanner = useNotificationBanner(fixture.ui?.notificationBanner === true, live);

  // #640（r14 §5.7）：开始 = 直发总管编排回合，无 dialog 确认位——两个
  // 入口（卡片 开始 钮 onAction / 拖入执行中 onStartIntent）同一条发射路。
  // 落位不写相位：卡留待开始，总管派发（run_builds → queued）后才进执行中；
  // T0 反馈 = toast + 查看会话深链（use-orchestrate-start.ts）。
  const startTask = useCallback(
    (todo: TodoRecord) => {
      if (!live) return;
      orchestrateStart.orchestrate({ id: todo.id, seqNum: todo.seqNum });
    },
    [live, orchestrateStart.orchestrate],
  );
  // #1216：逐卡在飞编排（卡面「编排中」底栏 + 等待成因的数据源）。
  const orchestrationOf = useCallback(
    (todo: TodoRecord) => cardOrchestration(chiefThreadsQ.data, todo.seqNum),
    [chiefThreadsQ.data],
  );

  // 拖拽落位（#73 / M5 / #160，#616 收窄成纯改相）：待开始/已完成列的静默
  // 提交——fixture = 本地集；live = 逐卡增量 PATCH（phase = 手动改相 +
  // orderIndex = 列内排序位，server patchTodoBodySchema 两位）。落点 = 目标
  // 列视图末尾（endOfColumnIndex；参考站无列内位次语义）。diff 基线 = 落位
  // 前 todo 集：moveTodo 的输出已把 orderIndex 回写成列视图序，拿它自身重
  // 算再比恒相等（#160 前的死路），故与落位前快照比。
  const handlePhaseDrop = useCallback(
    (todo: TodoRecord, columnId: string) => {
      const next = moveTodo(todos, todo.id, columnId, live ? Date.now() : fixture.now);
      if (next === todos) return;
      if (!live) {
        setFixtureTodos(next);
        return;
      }
      const changes = new Map<string, ReorderPatch>();
      for (const after of next) {
        const before = todos.find((p) => p.id === after.id);
        if (before == null) continue;
        const body: ReorderPatch = {};
        if (before.phase !== after.phase) body.phase = after.phase;
        if (before.orderIndex !== after.orderIndex) body.orderIndex = after.orderIndex;
        if (body.phase === undefined && body.orderIndex === undefined) continue;
        changes.set(after.id, body);
      }
      if (changes.size === 0) return;
      // 乐观落位：卡片停在落点不弹回再跳；phaseAt 近似 server nowMs()。
      // 01 §4.1「server state 全走查询失效重取」裁定 [设计]：乐观值只是落点
      // 的同帧预览，真值源仍是 PATCH 回合的 invalidate 重取（成败两路收敛）。
      queryClient.setQueryData<WireTodo[]>(['todos', teamId], (old) =>
        old?.map((w) => {
          const body = changes.get(w.id);
          if (body == null) return w;
          return {
            ...w,
            ...(body.phase !== undefined ? { phase: body.phase, phaseAt: Date.now() } : {}),
            ...(body.orderIndex !== undefined ? { orderIndex: body.orderIndex } : {}),
          };
        }),
      );
      for (const [id, body] of changes) {
        mutations.patchTodo.mutate(
          { id, body },
          // 409/网络败 = 乐观值作废，重取回 server 真值（卡片弹回 = 真值）；
          // #638 弹回只讲结果不讲原因——toast 点名失败（server 原因进
          // description），与回滚不互斥（回滚收敛数据，toast 解释发生了什么）。
          {
            onError: (error) => {
              queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
              toastError(t('移动任务失败，请重试。'), error);
            },
          },
        );
      }
    },
    [live, todos, fixture.now, teamId, mutations.patchTodo, queryClient, t],
  );

  // #1247 done 落位闸：待处理 / 在飞卡拖向已完成先开确认弹层（判据单源
  // columns.needsDoneGate）。取消 = 零提交；outcome = done|closed；inflight =
  // POST stop-and-done。竞态由乐观回滚 + toast 兜底（#638 同律）。
  const [doneTarget, setDoneTarget] = useState<TodoRecord | null>(null);
  const [doneConfirming, setDoneConfirming] = useState(false);
  const openDoneGate = useCallback((todo: TodoRecord) => setDoneTarget(todo), []);
  const closeDoneGate = useCallback(() => {
    if (doneConfirming) return;
    setDoneTarget(null);
  }, [doneConfirming]);
  const commitDonePhase = useCallback(
    (todo: TodoRecord, phase: 'done' | 'closed') => {
      const next = moveTodo(todos, todo.id, 'done', live ? Date.now() : fixture.now, phase);
      if (next === todos) return;
      if (!live) {
        setFixtureTodos(next);
        return;
      }
      const after = next.find((t) => t.id === todo.id);
      if (after == null) return;
      const body: ReorderPatch = { phase: after.phase, orderIndex: after.orderIndex };
      queryClient.setQueryData<WireTodo[]>(['todos', teamId], (old) =>
        old?.map((w) =>
          w.id === todo.id
            ? { ...w, phase: after.phase, phaseAt: Date.now(), orderIndex: after.orderIndex }
            : w,
        ),
      );
      mutations.patchTodo.mutate(
        { id: todo.id, body },
        {
          onError: (error) => {
            queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
            toastError(t('移动任务失败，请重试。'), error);
          },
        },
      );
    },
    [live, todos, fixture.now, teamId, mutations.patchTodo, queryClient, t],
  );
  const confirmDone = useCallback(() => {
    if (doneTarget == null) return;
    commitDonePhase(doneTarget, 'done');
    setDoneTarget(null);
  }, [doneTarget, commitDonePhase]);
  const confirmCanceled = useCallback(() => {
    if (doneTarget == null) return;
    commitDonePhase(doneTarget, 'closed');
    setDoneTarget(null);
  }, [doneTarget, commitDonePhase]);
  const confirmStopThenDone = useCallback(async () => {
    if (doneTarget == null) return;
    if (!live) {
      commitDonePhase(doneTarget, 'done');
      setDoneTarget(null);
      return;
    }
    setDoneConfirming(true);
    try {
      const result = (await api.post(
        `/api/todos/${doneTarget.id}/stop-and-done`,
        {},
      )) as StopAndDoneResult;
      if (result.state === 'done') {
        queryClient.setQueryData<WireTodo[]>(['todos', teamId], (old) =>
          old?.map((w) => (w.id === result.todo.id ? result.todo : w)),
        );
        queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
        setDoneTarget(null);
        return;
      }
      // claimed：等相位到 done（SSE / 轮询）
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 400));
        const fresh = (await api.get(`/api/todos/${doneTarget.id}`)) as WireTodo;
        if (fresh.phase === 'done') {
          queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
          setDoneTarget(null);
          return;
        }
      }
      throw new Error('stop-and-done timed out');
    } catch (error) {
      queryClient.invalidateQueries({ queryKey: ['todos', teamId] });
      toastError(t('停止并完成失败，请重试。'), error);
    } finally {
      setDoneConfirming(false);
    }
  }, [doneTarget, live, commitDonePhase, queryClient, teamId, t]);

  // #828: 看板 branch 弹层的数据面——fixture 面走 overlayContent 冻结值；
  // live 面按 overlayTodo.latestBuildId 经 mapBranchInfo 现算（与详情页右
  // pane 同源）。此前 live 面同样走 overlayContent，真 todo id 恒 miss →
  // content 恒 null → 按钮点击零响应（「点不开」的 bug 半）。两个查询都挂
  // 在弹层打开门下，平时零请求。
  const branchOpen = overlay?.kind === 'branch';
  const branchBuildId = overlayTodo?.latestBuildId ?? null;
  const branchQueryId = branchOpen ? branchBuildId : null;
  const branchStepsQ = useSteps(branchQueryId, live && branchQueryId != null);
  const branchMachinesQ = useMachines(teamId, live && branchOpen);
  const branchInfo =
    overlayTodo == null
      ? null
      : live
        ? branchBuildId != null
          ? mapBranchInfo(branchBuildId, branchStepsQ.data ?? [], branchMachinesQ.data ?? [])
          : null
        : (overlayContent(overlayTodo.id)?.branch ?? null);
  // live overlay 数据（验收合并只依赖 latestBuildId）。
  // live 面 now = 墙钟（相对时间标签随 SSE 失效重渲染滚动）；fixture 面保持
  // 冻结采集时刻（采集确定性）。projectNames = 卡面/搜索/新建 dialog 的
  // 项目 chip 真名位（fixture 面缺省走 capture canon 常量）。
  const projectNames = useMemo(() => {
    if (!live) return undefined;
    return Object.fromEntries((projectsQ.data ?? []).map((p) => [p.id, p.name]));
  }, [live, projectsQ.data]);
  const fixtureWithTodos: FixtureSet = live
    ? { ...fixture, todos, now: Date.now(), ...(projectNames ? { projectNames } : {}) }
    : { ...fixture, todos };
  // #1261 等额度横幅：挂起优先于浏览器通知引导条（断粮是告警，权限引导是
  // 提示——同槽互斥，横幅更该被看见）。todo doc SSE 失效重取驱动出现/消失。
  const quotaInfos = quotaBannerInfo(todos);
  return (
    // ADR 0013 D1：让位退役——悬浮窗是覆盖层，board 列不再随面板开合变轨。
    // #1035 的两态地板（常态 200 / 停靠 280）随 data-chief-open 标记收敛回
    // 单态：--board-col-min 200px（四列全见优先，更窄由地板接管回诚实横滚，
    // board-zoom-fit.spec 语义不变）；--board-col-min-docked 已删（tokens.css），
    // 轨道规则单源不分支（board.tsx scroller 只消费 --board-col-min）。
    <div className="board-shell flex h-full overflow-hidden bg-(--surface-1)" data-route="board">
      <AppSidebar
        fixture={fixture}
        todos={todos}
        selected={
          chiefView === 'settings' ? 'none' : onlyColumn === 'pending' ? 'attention' : 'board'
        }
        searchPanel={false}
        onSearch={() => search.setOpen(true)}
        onNewTask={openNewTask}
      />
      <div className={`board-sheet ${SHEET_PANEL}`}>
        {chiefView === 'settings' ? (
          <ChiefSettings
            chief={chiefData}
            onBack={() => setChiefView('drawer')}
            // #895 fixture 面机器行集（live 面组件自取 useMachines 不吃它）
            machines={fixture.resources?.machines}
          />
        ) : (
          <BoardSurface
            fixture={fixtureWithTodos}
            banner={
              quotaInfos != null ? (
                <QuotaBanner infos={quotaInfos} />
              ) : notifyBanner.visible ? (
                <NotificationBanner onEnable={notifyBanner.enable} />
              ) : undefined
            }
            onAction={(todo) => {
              if (live) {
                // r7 34: review 完成 = accept dialog（merge 202 delegated，
                // r3 §3.6）；todo 开始 = 直发总管编排回合（#640，无 dialog）；
                // 其余关口进详情页操作。
                if (todo.phase === 'review' && todo.awaitingReply !== true) openFor(todo, 'accept');
                else if (todo.phase === 'todo') startTask(todo);
                else navigate(`/app/todo/${todo.id}`);
                return;
              }
              // r7 34: review-phase 完成 opens the accept dialog; 回复/确认
              // stay inert until their own tickets
              if (todo.phase === 'review' && todo.awaitingReply !== true) openFor(todo, 'accept');
            }}
            onBranch={(todo) => openFor(todo, 'branch')}
            // #828: 无分支的卡隐藏分支钮——fixture 面以 overlayContent 有无
            // 为准（点开必有弹层），live 面以 latestBuildId 有无为准（分支
            // 面按该 buildId 现算）。
            hasBranch={(todo) =>
              live ? todo.latestBuildId != null : overlayContent(todo.id) != null
            }
            orchestrationOf={live ? orchestrationOf : undefined}
            // #73→#616→#640: 静默改相落位（待处理/已完成 + 待开始的未开始卡）
            // commit into the same client-side todo set as create/delete — column
            // counts and folds re-derive from it；执行中落位 = 开始意图 → 直发
            // 编排回合（无 dialog 确认位，T0 反馈 = toast）；#755：待开始落点的
            // 已开始卡 = 重置意图 → 确认闸（确认前零提交）。
            onPhaseDrop={handlePhaseDrop}
            onStartIntent={startTask}
            onResetIntent={openResetGate}
            onDoneIntent={openDoneGate}
            filters={filters}
            onlyColumn={onlyColumn}
            tagsById={tagIndex.tagById}
            onNewTask={openNewTask}
          />
        )}
      </div>
      <SearchPanel
        open={search.open}
        fixture={live ? { ...fixture, todos, now: Date.now() } : fixture}
        query={search.query}
        onQuery={search.setQuery}
        onClose={() => search.setOpen(false)}
        server={live ? searchResults.data : undefined}
      />
      {/* #389: dialog 接线全走新建任务面（侧栏 C 热键/新任务行的 opener 也
          指这里——openNewTask）；fixture 保存落点 = 本页 onFixtureSave 本地
          卡 append（#66 律）。XMON-93：面体住隔离根叶子，本页只持 ref。 */}
      <NewTaskSurfaceRoot
        fixture={fixture}
        opts={{ fixtureTodos, eager: true, onFixtureSave }}
        apiRef={newTaskApiRef}
      />
      <AcceptDialog
        open={overlay?.kind === 'accept'}
        onClose={closeOverlay}
        missingTools={mergeMissing}
        rejectReason={mergeReject}
        substantiveChanges={live ? substantiveChanges : null}
        mergeLocked={overlayWire?.phase === 'failed'}
        confirming={mutations.mergeBuild.isPending || donePatchPending}
        onConfirm={
          live
            ? (merge) => {
                // 目标取 overlayWire（列表读面现值）兜底 overlayTodo（开窗快照）
                // ——rework 轮换过 latestBuildId 时快照会指旧 build。#1236：
                // live 面确认钮恒有真动作，目标缺位时弹层不关、alert 行点名
                // 原因，不再静默关闭。
                const target = overlayWire ?? overlayTodo;
                if (target == null || target.latestBuildId == null) {
                  setMergeReject(t('任务数据未就绪，完成请求未送出。请刷新页面后重试。'));
                  return;
                }
                if (!merge) {
                  // 不勾 = 完成但不合并（todo 级改相，#901 done 落位闸同一写
                  // 面语义，server 落 DONE_ANNOUNCEMENT 审计行）。
                  mutations.patchTodo.mutate(
                    { id: target.id, body: { phase: 'done' } },
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
                // XMON-89：关弹层改挂 onSuccess——被拒（403/409）时弹层留着
                // 显原因；#1236：202 委派到相位推进之间隔着机器执行，toast
                // 是这段窗口的可见回执。
                mutations.mergeBuild.mutate(target.latestBuildId, {
                  onSuccess: () => {
                    closeOverlay();
                    toastSuccess(t('已发起合并，机器执行完成后任务进入已完成。'));
                  },
                  onError: (error) => setMergeReject(mergeRejectCopy(error, t)),
                });
              }
            : undefined
        }
      />
      {branchInfo != null && (
        <BranchDialog
          open={overlay?.kind === 'branch'}
          info={branchInfo}
          buildId={overlayTodo?.latestBuildId ?? null}
          onClose={closeOverlay}
        />
      )}
      {/* #755 重置确认闸：已开始卡拖回待开始的落位闸——取消零提交，确认走
          POST /api/todos/:id/reset（fixture 面本地投影）。 */}
      <ResetConfirmDialog
        open={resetTarget != null}
        onClose={closeResetGate}
        onConfirm={() => void confirmReset()}
        confirming={resetting}
        stale={resetStale}
      />
      {/* #901 done 落位闸：闸相位有产物在审的卡拖向已完成的确认位——取消
          零提交，确认走 handlePhaseDrop（server 同落审计行 #902）。 */}
      <DoneConfirmDialog
        open={doneTarget != null}
        mode={doneTarget != null && isInflightDoneGate(doneTarget) ? 'inflight' : 'outcome'}
        confirming={doneConfirming}
        onClose={closeDoneGate}
        onConfirmDone={confirmDone}
        onConfirmCanceled={confirmCanceled}
        onConfirmStopThenDone={() => void confirmStopThenDone()}
      />
    </div>
  );
}

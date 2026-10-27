import type { TodoRecord as WireTodo } from '@cairn/shared';
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
import { BOARD_VIEW_PARAM } from '../board/home.js';
import { NotificationBanner, useNotificationBanner } from '../board/notify-banner.js';
import { QuotaBanner, quotaBannerInfo } from '../board/quota-banner.js';
import {
  buildRepoOptions,
  matchesProjectFilter,
  parseProjectsParam,
} from '../board/repo-filter.js';
import { ResetConfirmDialog } from '../board/reset-confirm-dialog.js';
import { buildTagOptions, matchesTagFilter, parseTagParam } from '../board/tag-filter.js';
import { ChiefHome } from '../chief/chief-home.js';
import { HomeSummary } from '../chief/chief-home-summary.js';
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
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';

interface ReorderPatch {
  phase?: TodoRecord['phase'];
  orderIndex?: number;
}

type StopAndDoneResult = { state: 'done' | 'stopping'; todo: WireTodo };

export function BoardPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { search: rawSearch } = useLocation();
  const queryClient = useQueryClient();
  const { live, teamId } = useLiveData();
  const fixture = resolveScenario(searchParams);
  const { surface: chief } = useChiefRoot();
  const { chiefView, setChiefView, chiefData } = chief;

  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const mutations = useApiMutations(teamId);
  const orchestrateStart = useOrchestrateStart();

  const rawTags = searchParams.get('tags');
  const onlyColumn = parseColumnParam(searchParams.get(COLUMN_PARAM));
  const boardView = searchParams.get(BOARD_VIEW_PARAM) === 'board';
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
  const tagVocab = useMemo(
    () => (typeReady ? [...new Set(tagIndex.ordered.map((tag) => tag.name))] : null),
    [typeReady, tagIndex.ordered],
  );
  const selectedTags = useMemo(() => parseTagParam(rawTags, tagVocab), [rawTags, tagVocab]);
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const repoOnly = useCallback(
    (todo: TodoRecord) => matchesProjectFilter(todo, selectedProjectSet),
    [selectedProjectSet],
  );
  const typeOnly = useCallback(
    (todo: TodoRecord) => matchesTagFilter(todo, selectedTagSet, tagIndex.nameById),
    [selectedTagSet, tagIndex.nameById],
  );
  const matchesBoth = useCallback(
    (todo: TodoRecord) => repoOnly(todo) && (typeReady ? typeOnly(todo) : true),
    [repoOnly, typeReady, typeOnly],
  );
  const filterActive = selectedProjects.length > 0 || (selectedTags.length > 0 && typeReady);
  const repoSource = useMemo<{ id: string; name: string }[]>(
    () =>
      live
        ? (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name }))
        : Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({ id, name })),
    [live, projectsQ.data, fixture],
  );
  const writeFilterParams = useCallback(
    (tags: string[], projects: string[]) => {
      const rest = new URLSearchParams(window.location.search);
      rest.delete('tags');
      rest.delete('projects');
      const parts = [
        rest.toString(),
        tags.length > 0 ? `tags=${tags.join(',')}` : '',
        projects.length > 0 ? `projects=${projects.join(',')}` : '',
      ].filter((s) => s !== '');
      navigate(`?${parts.join('&')}`, { replace: true });
    },
    [navigate],
  );
  const latestFilters = useCallback(() => {
    const current = new URLSearchParams(window.location.search);
    return {
      tags: parseTagParam(current.get('tags'), tagVocab),
      projects: parseProjectsParam(current.get('projects')),
    };
  }, [tagVocab]);
  const toggleTag = useCallback(
    (name: string) => {
      const { tags, projects } = latestFilters();
      const next = tags.includes(name)
        ? tags.filter((n) => n !== name)
        : parseTagParam([...tags, name].join(','), tagVocab);
      writeFilterParams(next, projects);
    },
    [latestFilters, tagVocab, writeFilterParams],
  );
  const toggleProject = useCallback(
    (id: string) => {
      const { tags, projects } = latestFilters();
      const next = projects.includes(id)
        ? projects.filter((p) => p !== id)
        : parseProjectsParam([...projects, id].join(','));
      writeFilterParams(tags, next);
    },
    [latestFilters, writeFilterParams],
  );
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
  const selectAllTags = useCallback(() => {
    if (tagVocab == null) return;
    writeFilterParams([...tagVocab].sort(), selectedProjects);
  }, [tagVocab, selectedProjects, writeFilterParams]);
  const selectAllProjects = useCallback(() => {
    if (repoSource.length === 0) return;
    writeFilterParams(selectedTags, repoSource.map((project) => project.id).sort());
  }, [repoSource, selectedTags, writeFilterParams]);
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

  const [fixtureTodos, setFixtureTodos] = useState<TodoRecord[]>(() =>
    withoutDeleted(fixture.todos),
  );
  const liveTodos = useMemo(() => (todosQ.data ?? []).map(toDisplayTodo), [todosQ.data]);
  const todos = live ? liveTodos : fixtureTodos;

  const repoOptions = useMemo(
    () => buildRepoOptions(repoSource, todos, typeOnly),
    [repoSource, todos, typeOnly],
  );
  const tagOptions = useMemo(
    () => buildTagOptions(tagIndex.ordered, todos, repoOnly, tagIndex.nameById),
    [tagIndex.ordered, todos, repoOnly, tagIndex.nameById],
  );
  const summarize = (labels: string[]): string =>
    labels.length <= 2
      ? labels.join(', ')
      : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  const repoLabels = selectedProjects.map(
    (id) => repoOptions.find((option) => option.id === id)?.name ?? id,
  );
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
  const onFixtureSave = useCallback(
    (spec: string) => {
      setFixtureTodos((prev) => [
        ...prev,
        localTodo(prev.reduce((max, t) => Math.max(max, t.seqNum), 0) + 1, spec, fixture.now),
      ]);
    },
    [fixture],
  );
  const newTaskApiRef = useRef<NewTaskSurfaceApi | null>(null);
  const openNewTask = useCallback(() => newTaskApiRef.current?.openDialog(), []);
  const [overlay, setOverlay] = useState<OverlayState | null>(fixture.overlay ?? null);
  const [overlayTodo, setOverlayTodo] = useState<TodoRecord | null>(null);
  const [mergeReject, setMergeReject] = useState<string | null>(null);
  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setMergeReject(null);
  }, []);
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
  const overlayWire = useMemo(
    () => (todosQ.data ?? []).find((wire) => wire.id === overlayTodo?.id) ?? null,
    [todosQ.data, overlayTodo],
  );
  const mergeMissing = useMergeGate(
    live ? (overlayWire?.assignment?.build?.agentId ?? null) : null,
  );
  const acceptBuildId =
    live && overlay?.kind === 'accept'
      ? (overlayWire?.latestBuildId ?? overlayTodo?.latestBuildId ?? null)
      : null;
  const acceptChangesQ = useBuildChanges(acceptBuildId, acceptBuildId != null);
  const substantiveChanges = substantiveChangesOf(acceptChangesQ.data, acceptChangesQ.isSuccess);
  const donePatchPending =
    mutations.patchTodo.isPending &&
    mutations.patchTodo.variables?.body.phase === 'done' &&
    mutations.patchTodo.variables?.id === overlayTodo?.id;
  const openFor = (todo: TodoRecord, kind: OverlayState['kind']) => {
    setOverlayTodo(todo);
    setOverlay({ kind });
  };
  const search = useSearchState(fixture.ui?.searchOpen === true, fixture.ui?.searchQuery ?? '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const notifyBanner = useNotificationBanner(fixture.ui?.notificationBanner === true, live);

  const startTask = useCallback(
    (todo: TodoRecord) => {
      if (!live) return;
      orchestrateStart.orchestrate({ id: todo.id, seqNum: todo.seqNum });
    },
    [live, orchestrateStart.orchestrate],
  );
  const orchestrationOf = useCallback(
    (todo: TodoRecord) => cardOrchestration(chiefThreadsQ.data, todo.seqNum),
    [chiefThreadsQ.data],
  );

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
  const projectNames = useMemo(() => {
    if (!live) return undefined;
    return Object.fromEntries((projectsQ.data ?? []).map((p) => [p.id, p.name]));
  }, [live, projectsQ.data]);
  const fixtureWithTodos: FixtureSet = live
    ? { ...fixture, todos, now: Date.now(), ...(projectNames ? { projectNames } : {}) }
    : { ...fixture, todos };
  const quotaInfos = quotaBannerInfo(todos);
  const todoGlances = useMemo(
    () =>
      new Map(
        todos.map((todo) => [todo.id, { phase: todo.phase, seq: todo.seqNum, title: todo.title }]),
      ),
    [todos],
  );
  return (
    <div className="board-shell flex h-full overflow-hidden bg-(--surface-1)" data-route="board">
      <AppSidebar
        fixture={fixture}
        todos={todos}
        selected={chiefView === 'settings' ? 'none' : boardView ? 'kanban' : 'board'}
        searchPanel={false}
        onSearch={() => search.setOpen(true)}
        onNewTask={openNewTask}
      />
      <div className={`board-sheet ${SHEET_PANEL}`}>
        {chiefView === 'settings' ? (
          <ChiefSettings
            chief={chiefData}
            onBack={() => setChiefView('drawer')}
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
                if (todo.phase === 'review' && todo.awaitingReply !== true) openFor(todo, 'accept');
                else if (todo.phase === 'todo') startTask(todo);
                else navigate(`/app/todo/${todo.id}`);
                return;
              }
              if (todo.phase === 'review' && todo.awaitingReply !== true) openFor(todo, 'accept');
            }}
            onBranch={(todo) => openFor(todo, 'branch')}
            hasBranch={(todo) =>
              live ? todo.latestBuildId != null : overlayContent(todo.id) != null
            }
            orchestrationOf={live ? orchestrationOf : undefined}
            onPhaseDrop={handlePhaseDrop}
            onStartIntent={startTask}
            onResetIntent={openResetGate}
            onDoneIntent={openDoneGate}
            filters={filters}
            onlyColumn={onlyColumn}
            boardView={boardView}
            renderHome={(home) => (
              <ChiefHome
                surface={chief}
                now={fixtureWithTodos.now}
                summary={<HomeSummary {...home} />}
                below={home.sections}
                todoGlances={todoGlances}
              />
            )}
            tagsById={tagIndex.tagById}
            onNewTask={openNewTask}
            loading={live && !todosQ.isSuccess}
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
        infoOutput={overlayWire?.output === 'info'}
        confirming={mutations.mergeBuild.isPending || donePatchPending}
        onConfirm={
          live
            ? (merge) => {
                const target = overlayWire ?? overlayTodo;
                if (target == null || target.latestBuildId == null) {
                  setMergeReject(t('任务数据未就绪，完成请求未送出。请刷新页面后重试。'));
                  return;
                }
                if (!merge) {
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
                mutations.mergeBuild.mutate(target.latestBuildId, {
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
      {branchInfo != null && (
        <BranchDialog
          open={overlay?.kind === 'branch'}
          info={branchInfo}
          buildId={overlayTodo?.latestBuildId ?? null}
          onClose={closeOverlay}
        />
      )}
      <ResetConfirmDialog
        open={resetTarget != null}
        onClose={closeResetGate}
        onConfirm={() => void confirmReset()}
        confirming={resetting}
        stale={resetStale}
      />
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

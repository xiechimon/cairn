import {
  Archive,
  ChevronDown,
  FolderOpen,
  FolderX,
  Link2,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApiMutations, useProjects, useTodos } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { RenameThreadDialog } from '../board/rename-dialog.js';
import { THREAD_TONE, threadHref, threadStatus } from '../board/sidebar-threads.js';
import { ChiefConversation } from '../chief/chief-conversation.js';
import { greetingFor } from '../chief/chief-home.js';
import { HandoffCardContext } from '../chief/chief-message-rows.js';
import { useProjectCoordinatorSurface } from '../chief/use-project-coordinator.js';
import { EmptyState } from '../components/empty-state.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { HeaderIconButton } from '../components/shell/header-icon-button.js';
import { GoalLine } from '../components/stream/goal-line.js';
import { Greeting } from '../components/stream/greeting.js';
import { StreamDigest } from '../components/stream/stream-digest.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { SpiralMark, TextureSkeleton } from '../components/texture/texture.js';
import { ThreadCard } from '../components/thread/thread-card.js';
import { AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import type { TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteProjectConfirm } from '../overlay/delete-project-confirm.js';
import { PageShell } from './shell.js';

const STARTERS = ['做个计划', '接一个仓库', '接着最近的活', '用我的工具'] as const;

type CardCopy = { state: string; reason: string; primary?: string };

function cardCopy(todo: TodoRecord): CardCopy {
  if (todo.awaitingReply === true) {
    return { state: '待你处理', reason: '在问你一个问题。', primary: '回答' };
  }
  switch (todo.phase) {
    case 'confirm':
      return { state: '待你处理', reason: '计划已就绪，批准后开工。', primary: '看计划' };
    case 'review':
      return { state: '等你审阅', reason: '已就绪，等你审阅。', primary: '审阅' };
    case 'failed':
      return { state: '待你处理', reason: '失败了，打开它重试。' };
    case 'queued':
      return { state: '运行中', reason: '排队等机器。' };
    case 'planning':
      return { state: '运行中', reason: '正在写计划。' };
    case 'building':
      return { state: '运行中', reason: '正在动手。' };
    case 'done':
    case 'closed':
      return { state: '已解决', reason: '已完成。' };
    case 'todo':
      return { state: '空闲', reason: '还没开始。' };
  }
}

export function ProjectHome() {
  const { id } = useParams();
  return <ProjectHomeBody key={id} />;
}

function ProjectHomeBody() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId, user } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const todosQ = useTodos(teamId, live);
  const mutations = useApiMutations(teamId);
  const mark = useProjectMark()(id);
  const wire = live ? (projectsQ.data ?? []).find((p) => p.id === id) : undefined;
  const name = live ? (wire?.name ?? '') : (fixture.projectNames?.[id ?? ''] ?? '');
  const goal = live ? (wire?.description ?? null) : (fixture.projectHome?.goal ?? null);
  const repo = live
    ? (wire?.githubRepo ?? wire?.repoName ?? null)
    : (fixture.projectHome?.repo ?? null);
  const [fixtureArchived, setFixtureArchived] = useState(fixture.projectHome?.archived === true);
  const archived = live ? wire?.archivedAt != null : fixtureArchived;
  const todos: TodoRecord[] = useMemo(
    () =>
      (live ? (todosQ.data ?? []).map(toDisplayTodo) : fixture.todos).filter(
        (todo) => todo.projectId === id,
      ),
    [live, todosQ.data, fixture.todos, id],
  );
  const coordinator = useProjectCoordinatorSurface(id, fixture);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const loading = live && (projectsQ.isLoading || coordinator.load === 'loading');
  const failed = live && projectsQ.isError;
  const missing = live && !loading && !failed && wire === undefined;
  const running = todos.filter((todo) => threadStatus(todo) === 'running').length;

  const setArchived = (next: boolean) => {
    if (!live) {
      setFixtureArchived(next);
      return;
    }
    if (id === undefined) return;
    mutations.projectArchive.mutate(
      { projectId: id, archived: next },
      {
        onError: (error) =>
          toastError(t(next ? '归档失败，请重试。' : '取消归档失败，请重试。'), error),
      },
    );
  };

  const renderCard = useCallback(
    (todoId: string): ReactNode => {
      const todo = todos.find((row) => row.id === todoId);
      if (todo == null) return null;
      const copy = cardCopy(todo);
      const open = () => navigate(threadHref(todo.id));
      return (
        <ThreadCard
          title={todo.title}
          tone={todo.phase === 'review' ? 'review' : THREAD_TONE[threadStatus(todo)]}
          stateLabel={t(copy.state)}
          reason={t(copy.reason)}
          {...(copy.primary != null ? { primaryLabel: t(copy.primary), onPrimary: open } : {})}
          viewLabel={t('查看 thread')}
          onView={open}
        />
      );
    },
    [todos, navigate, t],
  );

  const digest = [
    {
      tone: 'waiting' as const,
      count: todos.filter((todo) => threadStatus(todo) === 'needs-you').length,
      label: t('待你处理'),
    },
    { tone: 'working' as const, count: running, label: t('运行中') },
    {
      tone: 'resolved' as const,
      count: todos.filter((todo) => threadStatus(todo) === 'done').length,
      label: t('已解决'),
    },
  ];

  const starters = (
    <div data-testid="project-starter-chips" className="flex flex-wrap gap-2">
      {STARTERS.map((label) => (
        <SuggestionChip
          key={label}
          disabled={archived}
          onClick={() => setPrefill({ text: t(label), key: Date.now() })}
        >
          {t(label)}
        </SuggestionChip>
      ))}
    </div>
  );
  const goalLine = goal != null && goal !== '' && (
    <div data-testid="project-goal">
      <GoalLine>{goal}</GoalLine>
    </div>
  );

  const hero = (
    <header
      data-testid="project-home-hero"
      className="mx-auto flex w-[calc(100%-2rem)] max-w-182 flex-col gap-4 pt-[12vh]"
    >
      <SpiralMark className="size-8" />
      <Greeting wrap>{t('新项目：{name}。先从哪里开始？', { name })}</Greeting>
      {goalLine}
      {starters}
      <p className="m-0 text-meta text-content-tertiary">
        {t('Coordinator 按目标做计划并开出 thread，thread 随进展出现在这里。')}
      </p>
    </header>
  );

  const lead = (
    <section
      data-testid="project-home-lead"
      aria-label={t('项目概况')}
      className="flex flex-col gap-4 pt-6 pb-6"
    >
      {goalLine}
      <Greeting>
        {t('{greeting}，{name}', {
          greeting: t(greetingFor(new Date(live ? Date.now() : fixture.now).getHours())),
          name: user.displayName,
        })}
      </Greeting>
      <StreamDigest rows={digest} />
    </section>
  );

  const copyLink = () => {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/app/project/${id}`)
      .then(() => toastSuccess(t('链接已复制')));
  };

  const title = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="-ml-1.5 h-8 gap-2 px-1.5 font-serif text-page font-semibold tracking-[-0.01em] text-foreground"
          />
        }
      >
        <ProjectAvatar name={name} tone={mark.tone} icon={mark.icon} color={mark.color} bare />
        {name}
        <ChevronDown aria-hidden="true" className="size-3.5 text-content-tertiary" />
      </DropdownMenuTrigger>
      <KeyedMenuContent align="start" className="w-52">
        <KeyedMenuItem shortcut="R" onClick={() => setRenameOpen(true)}>
          <Pencil />
          {t('重命名')}
        </KeyedMenuItem>
        <KeyedMenuItem onClick={() => navigate(`/app/project/${id}/settings`)}>
          <Settings2 />
          {t('设置')}
        </KeyedMenuItem>
        <KeyedMenuItem shortcut="L" onClick={copyLink}>
          <Link2 />
          {t('复制链接')}
        </KeyedMenuItem>
        <DropdownMenuSeparator />
        {archived ? (
          <KeyedMenuItem shortcut="A" onClick={() => setArchived(false)}>
            <Archive />
            {t('取消归档')}
          </KeyedMenuItem>
        ) : (
          <KeyedMenuItem shortcut="A" confirms onClick={() => setArchiveOpen(true)}>
            <Archive />
            {t('归档')}
          </KeyedMenuItem>
        )}
        <KeyedMenuItem
          shortcut="D"
          confirms
          variant="destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 />
          {t('删除')}
        </KeyedMenuItem>
      </KeyedMenuContent>
    </DropdownMenu>
  );

  return (
    <PageShell
      route="project-home"
      bleed
      taskPanel
      fixture={fixture}
      selected="none"
      title={
        <span data-testid="project-home-header" className="flex min-w-0 items-center gap-3">
          {title}
          <span className="min-w-0 truncate font-sans text-meta font-normal text-content-tertiary">
            {repo != null ? `Coordinator · ${repo}` : 'Coordinator'}
          </span>
        </span>
      }
      actions={
        <>
          <HeaderIconButton
            aria-label={t('文件')}
            onClick={() => navigate(`/app/project/${id}/files`)}
          >
            <FolderOpen className="size-4" />
          </HeaderIconButton>
          <HeaderIconButton
            aria-label={t('项目设置')}
            onClick={() => navigate(`/app/project/${id}/settings`)}
          >
            <Settings2 className="size-4" />
          </HeaderIconButton>
        </>
      }
    >
      {loading ? (
        <TextureSkeleton className="mx-auto mt-[12vh] h-40 w-[calc(100%-2rem)] max-w-182" />
      ) : failed ? (
        <EmptyState
          testId="project-home-error"
          icon={FolderX}
          title={t('项目加载失败')}
          description={t('请刷新页面重试。')}
          className="mt-[12vh]"
        />
      ) : missing ? (
        <EmptyState
          testId="project-home-missing"
          icon={FolderX}
          title={t('找不到这个项目')}
          description={t('它可能已被删除，或链接不对。')}
          className="mt-[12vh]"
        />
      ) : coordinator.load === 'error' ? (
        <EmptyState
          testId="project-home-conversation-error"
          icon={FolderX}
          title={t('对话加载失败')}
          description={t('对话记录还在，重试一下。')}
          action={{ label: t('重试'), onClick: coordinator.retry }}
          className="mt-[12vh]"
        />
      ) : (
        <section
          data-testid="project-home"
          aria-label={t('与 Coordinator 的对话')}
          aria-busy={coordinator.load === 'loading'}
          className="flex min-h-0 flex-1 flex-col"
        >
          <MessageScrollerProvider defaultScrollPosition="end">
            <HandoffCardContext.Provider value={renderCard}>
              <ChiefConversation
                key={id}
                variant="project"
                chief={coordinator.chiefData}
                onSend={archived ? undefined : coordinator.onSend}
                onRewind={coordinator.onRewind}
                onAnswerQuestion={coordinator.onAnswerQuestion}
                onCancelQuestion={coordinator.onCancelQuestion}
                onWithdraw={coordinator.onWithdraw}
                onSteer={coordinator.onSteer}
                onStop={coordinator.onStop}
                onSettings={() => navigate('/app?chief=settings')}
                threadsOpen={false}
                setThreadsOpen={() => {}}
                hero={hero}
                lead={lead}
                draftStorageKey={`cairn.coordinator-draft.${id}`}
                initialDraft={fixture.projectHome?.sendError?.draft ?? ''}
                prefill={prefill}
                placeholder={t('问 Coordinator，或描述一个新 thread…')}
                composerError={coordinator.sendError}
                composerReplacement={
                  archived ? (
                    <NoticeBanner
                      data-testid="project-archived-banner"
                      tone="info"
                      icon={Archive}
                      className="mx-auto mt-2 mb-4 w-[calc(100%-2rem)] max-w-182"
                      title={t('项目已归档。thread 只读，定时任务已暂停。')}
                      actions={
                        <Button size="sm" onClick={() => setArchived(false)}>
                          {t('取消归档')}
                        </Button>
                      }
                    />
                  ) : undefined
                }
              />
            </HandoffCardContext.Provider>
          </MessageScrollerProvider>
        </section>
      )}
      {renameOpen && (
        <RenameThreadDialog
          title={t('重命名项目')}
          initialTitle={name}
          onClose={() => setRenameOpen(false)}
          onSave={(next) => {
            setRenameOpen(false);
            if (live && id !== undefined) {
              mutations.patchProject.mutate(
                { id, body: { name: next } },
                { onError: (error) => toastError(t('重命名失败，请重试。'), error) },
              );
            }
          }}
        />
      )}
      <AlertDialogShell
        title={t('归档 {name}？', { name })}
        ariaLabel={t('归档 {name}？', { name })}
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setArchiveOpen(false)}
            >
              {t('取消')}
            </Button>
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              onClick={() => {
                setArchiveOpen(false);
                setArchived(true);
              }}
            >
              {t('归档')}
            </Button>
          </>
        }
      >
        <p className="m-0 text-ui text-content-secondary">
          {t('thread 变成只读，定时任务暂停。')}
          {running === 1 && ` ${t('1 个运行中的 thread 先跑完当前这一轮。')}`}
          {running > 1 && ` ${t('{n} 个运行中的 thread 先跑完当前这一轮。', { n: running })}`}
          {` ${t('不会删除任何东西，随时可以取消归档。')}`}
        </p>
      </AlertDialogShell>
      <DeleteProjectConfirm
        projectName={name}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          if (live && id !== undefined) {
            mutations.deleteProject.mutate(id, {
              onSuccess: () => navigate('/app'),
              onError: (error) => toastError(t('删除项目失败，请重试。'), error),
            });
          }
        }}
      />
    </PageShell>
  );
}

import type { CreateScheduleBody } from '@cairn/shared';
import { cn } from 'cn';
import { Clock, Lightbulb, Plus, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useProjects, useSchedules, useTeams, useTodos } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { FormActions } from '../components/form-layout.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import {
  markDeleted,
  markScheduleCreated,
  withCreatedSchedules,
  withoutDeleted,
} from '../fixtures/deletions.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { EllipsisVertical, Trash2 } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PHASE_UI } from '../phase.js';
import { ScheduleDetailController } from '../schedules/schedule-detail-dialog.js';
import { ScheduleFields } from '../schedules/schedule-fields.js';
import { type ScheduleDraft, scheduleBody, scheduleDraft } from '../schedules/schedule-model.js';
import { scheduleSummary } from './schedule-summary.js';
import { PageShell } from './shell.js';

function ScheduleCard({
  schedule,
  now,
  onOpen,
  onDelete,
}: {
  schedule: ScheduleRecord;
  now: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const ui = PHASE_UI[schedule.todo.phase];
  return (
    <div className={cn('sched-card', SETTINGS_ROW_CLS)}>
      <Button
        variant="ghost"
        aria-label={t('Open schedule {title}', { title: schedule.todo.title })}
        onClick={onOpen}
        className="h-auto min-w-0 flex-1 justify-start rounded-none p-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui text-foreground">{`#${schedule.todo.seqNum} ${schedule.todo.title}`}</span>
          <span className="truncate text-meta text-content-tertiary">{`${schedule.enabled === false ? (schedule.pausedReason ?? t('已暂停')) : scheduleSummary(schedule, now, t)} · ${schedule.todo.projectName}`}</span>
        </span>
      </Button>
      <StatusChip tone={ui.tone} className="flex-none">
        {t(ui.chip)}
      </StatusChip>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="sched-card-more cursor-pointer text-muted-foreground"
              aria-label={t('更多')}
            />
          }
        >
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <KeyedMenuContent
          align="end"
          sideOffset={4}
          aria-label={t('更多')}
          className="sched-card-menu w-40"
        >
          <KeyedMenuItem
            shortcut="D"
            confirms
            variant="destructive"
            className="sched-card-menu-row cursor-pointer"
            data-action="delete"
            onClick={onDelete}
          >
            <Trash2 />
            {t('删除')}
          </KeyedMenuItem>
        </KeyedMenuContent>
      </DropdownMenu>
    </div>
  );
}

type SetupState = 'ready' | 'loading' | 'error' | 'no-team' | 'no-thread' | 'no-project';

function ScheduleForm({
  value,
  onChange,
  todo,
  repo,
  tz,
  open,
  busy,
  error,
  setupState,
  retryBusy,
  onRetry,
  onClose,
  onSave,
}: {
  value: ScheduleDraft;
  onChange: (value: ScheduleDraft) => void;
  todo: { seqNum: number; title: string } | undefined;
  repo: string;
  tz: string;
  open: boolean;
  busy: boolean;
  error: string | null;
  setupState: SetupState;
  retryBusy: boolean;
  onRetry: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const cronValid = value.trigger !== 'custom' || value.cron.trim().split(/\s+/).length === 5;
  return (
    <DialogShell
      title={t('新建定时')}
      open={open}
      onClose={onClose}
      initialFocus={() =>
        document.activeElement?.matches(':focus-visible') === true ? true : bodyRef.current
      }
      size="m"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('保存'),
            onClick: onSave,
            disabled: busy || todo === undefined || !cronValid || setupState !== 'ready',
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <div ref={bodyRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <div className="sched-form-row flex h-8 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 shadow-xs dark:bg-input/30">
          <span className="text-ui text-foreground">{t('项目')}</span>
          <span className="min-w-0 truncate text-ui text-foreground">{repo}</span>
        </div>
        <div className="sched-form-row flex h-8 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 shadow-xs dark:bg-input/30">
          <span className="text-ui text-foreground">{t('任务')}</span>
          <span className="min-w-0 truncate text-ui text-foreground">
            {todo === undefined ? '—' : `#${todo.seqNum} ${todo.title}`}
          </span>
        </div>
        {setupState !== 'ready' && (
          <div
            role={setupState === 'error' ? 'alert' : 'status'}
            className="flex flex-col gap-2 text-meta text-content-secondary"
          >
            {setupState === 'error'
              ? t('Schedule setup could not be loaded.')
              : setupState === 'loading'
                ? t('Loading schedule setup…')
                : setupState === 'no-team'
                  ? t('No team is available for this schedule.')
                  : setupState === 'no-thread'
                    ? t('Create a thread before scheduling it.')
                    : t('The project for this thread is unavailable.')}
            {setupState !== 'loading' && (
              <Button variant="outline" size="sm" disabled={retryBusy} onClick={onRetry}>
                {t('重试')}
              </Button>
            )}
          </div>
        )}
        <ScheduleFields value={value} onChange={onChange} tz={tz} disabled={busy} />
        {error !== null && (
          <p role="alert" className="m-0 break-words text-meta text-destructive">
            {error}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

export function SchedulesPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const teamsQ = useTeams(live);
  const schedulesQ = useSchedules(live);
  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const now = live ? Date.now() : fixture.now;
  const tz = live ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Shanghai';
  const [formOpen, setFormOpen] = useState(false);
  const [fixtureFormOpen, setFixtureFormOpen] = useState<boolean | null>(null);
  const [liveDraft, setLiveDraft] = useState(() => scheduleDraft(null, Date.now(), tz));
  const [fixtureDraft, setFixtureDraft] = useState<ScheduleDraft>(() => ({
    ...scheduleDraft(null, fixture.now, 'Asia/Shanghai'),
    trigger: fixture.scheduleForm ?? 'daily',
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const schedules = withoutDeleted(
    live
      ? (schedulesQ.data ?? []).map((row) => ({ ...row, at: row.at ?? now }))
      : withCreatedSchedules(fixture.schedules ?? []),
  );
  const [selected, setSelected] = useState<ScheduleRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRecord | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const liveTodos = (todosQ.data ?? []).map(toDisplayTodo);
  const liveTodo = todosQ.data?.[0];
  const todo = live ? liveTodo : fixture.todos[0];
  const draft = live ? liveDraft : fixtureDraft;
  const setupState: SetupState = !live
    ? 'ready'
    : teamsQ.isError || (teamId !== undefined && (todosQ.isError || projectsQ.isError))
      ? 'error'
      : teamsQ.isPending || (teamId !== undefined && (todosQ.isPending || projectsQ.isPending))
        ? 'loading'
        : teamId === undefined
          ? 'no-team'
          : liveTodo === undefined
            ? 'no-thread'
            : projectsQ.data?.some((project) => project.id === liveTodo.projectId) !== true
              ? 'no-project'
              : 'ready';
  const retrySetup = () => {
    if (teamsQ.isError || teamId === undefined) {
      void teamsQ.refetch();
      return;
    }
    if (todosQ.isError || todosQ.data?.length === 0) void todosQ.refetch();
    if (
      projectsQ.isError ||
      projectsQ.data?.some((project) => project.id === liveTodo?.projectId) !== true
    )
      void projectsQ.refetch();
  };
  const closeForm = () => {
    if (!mutations.createSchedule.isPending) {
      if (live) setFormOpen(false);
      else setFixtureFormOpen(false);
    }
  };
  const saveSchedule = async () => {
    if (todo === undefined || setupState !== 'ready') return;
    if (blockDemoWrite()) {
      closeForm();
      return;
    }
    setFormError(null);
    try {
      const body: CreateScheduleBody = scheduleBody(
        draft,
        { todoId: todo.id, projectId: todo.projectId, tz, enabled: true },
        now,
      );
      if (live) await mutations.createSchedule.mutateAsync(body);
      else {
        const at = body.at ?? now;
        const interval = {
          once: 86_400_000,
          hourly: 3_600_000,
          daily: 86_400_000,
          weekly: 604_800_000,
          cron: 0,
        }[body.kind];
        let nextRunAt: number | null = body.kind === 'cron' ? null : at;
        while (nextRunAt !== null && nextRunAt <= now) nextRunAt += interval;
        markScheduleCreated({
          ...body,
          projectId: todo.projectId,
          at,
          tz,
          nextRunAt,
          teamId: todo.teamId,
          createdBy: 'u-xmon-dai',
          todo: {
            seqNum: todo.seqNum,
            title: todo.title,
            phase: todo.phase,
            projectName: fixture.project?.name ?? '',
            ownerId: 'u-xmon-dai',
          },
        });
      }
      if (live) setFormOpen(false);
      else setFixtureFormOpen(false);
    } catch (failure) {
      setFormError(failure instanceof Error ? t(failure.message) : t('新建定时失败，请重试。'));
    }
  };
  return (
    <PageShell
      route="schedules"
      fixture={live ? { ...fixture, todos: liveTodos } : fixture}
      selected="schedules"
      title={t('定时')}
      actions={
        schedules.length > 0 && (
          <Button
            className={`page-new-action ${TOPBAR_PRIMARY_BUTTON}`}
            onClick={() => {
              setFormError(null);
              if (live) setFormOpen(true);
              else setFixtureFormOpen(true);
            }}
          >
            <Plus aria-hidden strokeWidth={1.75} className="size-4" />
            {t('新建')}
          </Button>
        )
      }
    >
      {live && schedulesQ.isError ? (
        <EmptyState
          testId="schedules-error"
          className="mt-6"
          icon={TriangleAlert}
          title={t('Scheduled tasks could not be loaded')}
          action={{
            label: t('重试'),
            disabled: schedulesQ.isFetching,
            onClick: () => void schedulesQ.refetch(),
          }}
        />
      ) : live && schedulesQ.isPending ? (
        <div
          data-testid="schedules-loading"
          role="status"
          className="py-12 text-center text-ui text-content-secondary"
        >
          {t('Loading scheduled tasks…')}
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          className="sched-empty mt-6"
          icon={Clock}
          title={t('还没有定时任务')}
          description={t(
            '按周期或在指定时间自动重新运行任务。每一轮都会依据任务描述从头开始一次全新运行，到达确认或审核关口时暂停，交由负责人接手。',
          )}
          action={{
            label: t('新建定时'),
            onClick: () => {
              setFormError(null);
              if (live) setFormOpen(true);
              else setFixtureFormOpen(true);
            },
          }}
          hint={{
            icon: Lightbulb,
            text: t('也可以直接告诉 Coordinator 某个任务要多久重跑一次，它会替你写好规则。'),
          }}
        />
      ) : (
        <SettingsCard className="mt-4">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              now={now}
              onOpen={() => setSelected(schedule)}
              onDelete={() => {
                setDeleteTarget(schedule);
                setConfirmOpen(true);
              }}
            />
          ))}
        </SettingsCard>
      )}
      <ScheduleForm
        value={draft}
        onChange={live ? setLiveDraft : setFixtureDraft}
        todo={todo}
        repo={
          live
            ? (projectsQ.data?.find((project) => project.id === liveTodo?.projectId)?.name ?? '')
            : (fixture.project?.repoName ?? '')
        }
        tz={tz}
        open={live ? formOpen : (fixtureFormOpen ?? fixture.scheduleForm !== undefined)}
        busy={mutations.createSchedule.isPending}
        error={formError}
        setupState={setupState}
        retryBusy={live && (teamsQ.isFetching || todosQ.isFetching || projectsQ.isFetching)}
        onRetry={retrySetup}
        onClose={closeForm}
        onSave={() => void saveSchedule()}
      />
      <ScheduleDetailController schedule={selected} now={now} onClose={() => setSelected(null)} />
      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除该定时？此操作不可撤销。')}
        summary={
          deleteTarget === null ? null : (
            <>
              <span className="text-content-tertiary">#{deleteTarget.todo.seqNum}</span>
              {deleteTarget.todo.title}
            </>
          )
        }
        ariaLabel={t('删除定时')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (deleteTarget === null) return;
          if (live)
            mutations.deleteSchedule.mutate(deleteTarget.id, {
              onError: (error) => toastError(t('删除定时失败，请重试。'), error),
            });
          else if (!blockDemoWrite()) markDeleted(deleteTarget.id);
          setConfirmOpen(false);
        }}
      />
    </PageShell>
  );
}

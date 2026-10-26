import { cn } from 'cn';
import { Clock, Lightbulb, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useProjects, useSchedules, useTodos } from '../api/hooks.js';
import { mapSchedules, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { FormActions } from '../components/form-layout.js';
import { SegmentedRadio } from '../components/segmented.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { toastError } from '../components/ui/toaster.js';
import {
  markDeleted,
  markScheduleCreated,
  withCreatedSchedules,
  withoutDeleted,
} from '../fixtures/deletions.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { EllipsisVertical, Trash2 } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PHASE_UI } from '../phase.js';
import { PageShell } from './shell.js';

const TZ_OFFSET = 8 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const hourMinute = (ts: number) => {
  const d = new Date(ts + TZ_OFFSET);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const monthDay = (ts: number, t: TFunc) => {
  const d = new Date(ts + TZ_OFFSET);
  return t('{mo}月{d}日', {
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    monthShort: EN_MONTHS[d.getUTCMonth()] ?? '',
  });
};
const dayWord = (ts: number, now: number, t: TFunc) =>
  monthDay(ts, t) === monthDay(now, t) ? t('今天') : monthDay(ts, t);

type ScheduleKind = ScheduleRecord['kind'];

const FREQ_LABEL: Record<ScheduleKind, string> = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  once: '单次',
};
const MINUTE_STEPS = ['00', '15', '30', '45'];
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));

const RUN_WORD: Record<ScheduleRecord['kind'], string> = {
  hourly: '每小时运行',
  daily: '每天运行',
  weekly: '每周运行',
  once: '运行一次',
};

const FORM_ROW_CLS =
  'sched-form-row flex h-8 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 shadow-xs dark:bg-input/30';

const FORM_ROW_VALUE_CLS = 'min-w-0 truncate text-ui text-foreground';

const FORM_LABEL_CLS = 'text-ui font-medium text-foreground';

function SchedSelect({
  value,
  options,
  label,
  menuLabel,
  triggerLabel,
  onPick,
}: {
  value: string;
  options: { value: string; label: string }[];
  label: string;
  menuLabel: string;
  triggerLabel: string;
  onPick: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onPick(next as string);
      }}
    >
      <SelectTrigger aria-label={triggerLabel} className="min-w-14">
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent aria-label={menuLabel}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScheduleCard({
  schedule,
  now,
  onDelete,
}: {
  schedule: ScheduleRecord;
  now: number;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const ui = PHASE_UI[schedule.todo.phase];
  return (
    <div className={cn('sched-card', SETTINGS_ROW_CLS)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-foreground">{`#${schedule.todo.seqNum} ${schedule.todo.title}`}</span>
        <span className="truncate text-meta text-content-tertiary">
          {`${monthDay(schedule.at, t)} ${hourMinute(schedule.at)} ${t(RUN_WORD[schedule.kind])} · ${t(
            '下次 {day} {time}',
            {
              day: dayWord(schedule.nextRunAt, now, t),
              time: hourMinute(schedule.nextRunAt),
            },
          )} · ${schedule.todo.projectName}`}
        </span>
      </div>
      <StatusChip tone={ui.tone} className="flex-none">
        {t(ui.chip)}
      </StatusChip>
      <span className="relative flex">
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
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            aria-label={t('更多')}
            className="sched-card-menu w-40"
          >
            <DropdownMenuItem
              variant="destructive"
              className="sched-card-menu-row cursor-pointer"
              data-action="delete"
              onClick={onDelete}
            >
              <Trash2 />
              {t('删除')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

function ScheduleForm({
  kind,
  onKind,
  hour,
  onHour,
  minute,
  onMinute,
  date,
  onDate,
  todo,
  repo,
  open,
  onClose,
  onSave,
}: {
  kind: ScheduleKind;
  onKind: (kind: ScheduleKind) => void;
  hour: string;
  onHour: (hour: string) => void;
  minute: string;
  onMinute: (minute: string) => void;
  date: string | null;
  onDate: (date: string) => void;
  todo: { seqNum: number; title: string } | undefined;
  repo: string;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('新建定时')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <FormActions
          className="pt-0"
          primary={{ label: t('保存'), onClick: onSave }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <div className={FORM_ROW_CLS}>
          <span className="text-ui text-content-secondary">{t('项目')}</span>
          <span className={FORM_ROW_VALUE_CLS}>{repo}</span>
        </div>
        <div className={FORM_ROW_CLS}>
          <span className="text-ui text-content-secondary">{t('任务')}</span>
          <span className={FORM_ROW_VALUE_CLS}>
            {todo == null ? '' : `#${todo.seqNum} ${todo.title}`}
          </span>
        </div>
        <SegmentedRadio
          optionHandle="sched-form-freq-tab"
          label={t('频率')}
          value={kind}
          onChange={onKind}
          options={(['hourly', 'daily', 'weekly', 'once'] as const).map((k) => ({
            value: k,
            label: t(FREQ_LABEL[k]),
          }))}
        />
        {kind === 'once' && (
          <>
            <div className={FORM_LABEL_CLS}>{t('日期')}</div>
            <div>
              <SchedSelect
                value={date ?? t('今天')}
                options={[{ value: t('今天'), label: t('今天') }]}
                label={date ?? t('今天')}
                menuLabel={t('日期')}
                triggerLabel={t('日期')}
                onPick={onDate}
              />
            </div>
          </>
        )}
        <div className={FORM_LABEL_CLS}>{t('时间')}</div>
        <div className="flex items-center gap-2">
          <SchedSelect
            value={hour}
            options={HOURS.map((h) => ({ value: h, label: h }))}
            label={hour}
            menuLabel={t('时')}
            triggerLabel={t('时')}
            onPick={onHour}
          />
          <SchedSelect
            value={minute}
            options={MINUTE_STEPS.map((m) => ({ value: m, label: m }))}
            label={minute}
            menuLabel={t('分')}
            triggerLabel={t('分')}
            onPick={onMinute}
          />
        </div>
        <div className="text-meta text-content-tertiary">
          {t('按你的本地时区运行（Asia/Shanghai）')}
        </div>
      </div>
    </DialogShell>
  );
}

export function SchedulesPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const schedulesQ = useSchedules(live);
  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const [formOpen, setFormOpen] = useState(false);
  const [fixtureFormOpen, setFixtureFormOpen] = useState<boolean | null>(null);
  const [formKind, setFormKind] = useState<ScheduleKind>('daily');
  const [formHour, setFormHour] = useState('09');
  const [formMinute, setFormMinute] = useState('00');
  const [fixtureKind, setFixtureKind] = useState<ScheduleKind>(fixture.scheduleForm ?? 'daily');
  const [fixtureHour, setFixtureHour] = useState('09');
  const [fixtureMinute, setFixtureMinute] = useState('00');
  const [formDate, setFormDate] = useState<string | null>(null);
  const schedules = withoutDeleted(
    live ? mapSchedules(schedulesQ.data ?? []) : withCreatedSchedules(fixture.schedules ?? []),
  );
  const now = live ? Date.now() : fixture.now;
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRecord | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const liveTodos = (todosQ.data ?? []).map(toDisplayTodo);
  const liveTodo = todosQ.data?.[0];
  const saveSchedule = () => {
    if (!liveTodo) {
      setFormOpen(false);
      return;
    }
    const base = new Date();
    base.setHours(Number(formHour), Number(formMinute), 0, 0);
    if (formKind === 'once' && base.getTime() < Date.now()) {
      base.setDate(base.getDate() + 1);
    }
    mutations.createSchedule.mutate(
      {
        todoId: liveTodo.id,
        projectId: liveTodo.projectId,
        kind: formKind,
        at: base.getTime(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { onError: (error) => toastError(t('新建定时失败，请重试。'), error) },
    );
    setFormOpen(false);
  };
  const saveScheduleFixture = () => {
    const todo = fixture.todos[0];
    if (todo == null) {
      setFixtureFormOpen(false);
      return;
    }
    const d = new Date(fixture.now + TZ_OFFSET);
    const at =
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        Number(fixtureHour),
        Number(fixtureMinute),
      ) - TZ_OFFSET;
    const step = {
      hourly: 3_600_000,
      daily: 86_400_000,
      weekly: 604_800_000,
      once: 86_400_000,
    }[fixtureKind];
    let nextRunAt = at;
    while (nextRunAt <= fixture.now) nextRunAt += step;
    markScheduleCreated({
      teamId: todo.teamId,
      projectId: todo.projectId,
      todoId: todo.id,
      kind: fixtureKind,
      at,
      tz: 'Asia/Shanghai',
      nextRunAt,
      createdBy: 'u-xmon-dai',
      todo: {
        seqNum: todo.seqNum,
        title: todo.title,
        phase: todo.phase,
        projectName: fixture.project?.name ?? '',
        ownerId: 'u-xmon-dai',
      },
    });
    setFixtureFormOpen(false);
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
            onClick={() => (live ? setFormOpen(true) : setFixtureFormOpen(true))}
          >
            <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
            {t('新建')}
          </Button>
        )
      }
    >
      {schedules.length === 0 ? (
        <EmptyState
          className="sched-empty mt-6"
          icon={Clock}
          title={t('还没有定时任务')}
          description={t(
            '按周期或在指定时间自动重新运行任务。每一轮都会依据任务描述从头开始一次全新运行，到达确认或审核关口时暂停，交由负责人接手。',
          )}
          action={{
            label: t('新建定时'),
            onClick: () => (live ? setFormOpen(true) : setFixtureFormOpen(true)),
          }}
          hint={{
            icon: Lightbulb,
            text: t('也可以直接告诉总管某个任务要多久重跑一次，它会替你写好规则。'),
          }}
        />
      ) : (
        <SettingsCard className="mt-4">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              now={now}
              onDelete={() => {
                setDeleteTarget(s);
                setConfirmOpen(true);
              }}
            />
          ))}
        </SettingsCard>
      )}
      {live ? (
        <ScheduleForm
          kind={formKind}
          onKind={setFormKind}
          hour={formHour}
          onHour={setFormHour}
          minute={formMinute}
          onMinute={setFormMinute}
          date={formDate}
          onDate={setFormDate}
          todo={liveTodo ? { seqNum: liveTodo.seqNum, title: liveTodo.title } : undefined}
          repo={projectsQ.data?.[0]?.name ?? ''}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSave={saveSchedule}
        />
      ) : (
        <ScheduleForm
          kind={fixtureKind}
          onKind={setFixtureKind}
          hour={fixtureHour}
          onHour={setFixtureHour}
          minute={fixtureMinute}
          onMinute={setFixtureMinute}
          date={formDate}
          onDate={setFormDate}
          todo={
            fixture.todos[0]
              ? { seqNum: fixture.todos[0].seqNum, title: fixture.todos[0].title }
              : undefined
          }
          repo={fixture.project?.repoName ?? ''}
          open={fixtureFormOpen ?? fixture.scheduleForm != null}
          onClose={() => setFixtureFormOpen(false)}
          onSave={saveScheduleFixture}
        />
      )}
      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除该定时？此操作不可撤销。')}
        summary={
          deleteTarget != null ? (
            <>
              <span className="text-content-tertiary">#{deleteTarget.todo.seqNum}</span>
              {deleteTarget.todo.title}
            </>
          ) : null
        }
        ariaLabel={t('删除定时')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (deleteTarget == null) return;
          if (live)
            mutations.deleteSchedule.mutate(deleteTarget.id, {
              onError: (error) => toastError(t('删除定时失败，请重试。'), error),
            });
          else markDeleted(deleteTarget.id);
          setConfirmOpen(false);
        }}
      />
    </PageShell>
  );
}

// Schedules route (issue #71): empty state pixel-bound to r7 11 (probe
// geometry: 768px centered column at x456, 48px tile @ y84, 75×30 primary
// @ y228), list card from r3 93, 新建定时 dialog from r3 92/92b with the
// 02 §9.2 copy canon (频率 tabs, 00/15/30/45 minute steps, tz note).
// #83 (M5): live 分支——列表 = GET /api/schedules 真值（SSE todo 事件联动
// 失效），新建 dialog 可交互（受控 tab/时/分 → POST /api/schedules，02 §9.2
// 触发闭环由 server Scheduler 兑现）；fixture 分支（r7 11/r3 92/93 行）不变。
// #306 接真：卡片「更多」钮开 per-card 菜单（anchored-overlay 家族律：Esc +
// 外点关）。菜单内容 [设计]——原站 sched 卡菜单内容未观测（r3 §9 仅录卡面），
// 唯一行「删除」沿 DELETE /api/schedules/:id 全链（route/service/web mutation
// 均已建、此前无 UI 入口）；删除走 DeleteConfirm 家族确认弹层。fixture 面
// 删除走 deletions.ts 覆面（session 局部），live 面走 mutation。
// #1037 三层收口（「看起来可点的东西，点下去必须有可解释的结果」）：
//   a. fixture 面不再有哑按钮——顶栏/空态两个新建入口、频率 tab、保存全部
//      接真 handler；保存走会话创建覆面（deletions.ts 同律，重载还原）。
//   b. 项目/任务/机器三行改静态展示行：r2 §6.6 只登记参考站预选值、picker
//      交互未观测，ChevronRight 可供性暗示随假行一并移除。
//   c. 对话框收编 DialogShell 家族律容器（封顶 + body 内滚 + footer 钉底），
//      自组裸 DialogContent 的第三套容器退役。

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

/** Capture-timezone offset (+08:00) — same convention as board/rel-time.ts:
 *  wall-clock labels are formatted in the capture tz so fixture output never
 *  drifts with the runner locale (CI runs UTC). */
const TZ_OFFSET = 8 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const hourMinute = (ts: number) => {
  const d = new Date(ts + TZ_OFFSET);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** en month abbreviations for the dict template ([设计] — the en line
 *  shape has no observed canon). */
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
/** r3 93 line 3 day word: same calendar day as the capture = 今天. */
const dayWord = (ts: number, now: number, t: TFunc) =>
  monthDay(ts, t) === monthDay(now, t) ? t('今天') : monthDay(ts, t);

/** 频率档（wire kind 同型）。 */
type ScheduleKind = ScheduleRecord['kind'];

/** 频率 tab words (02 §9.2 canon order). */
const FREQ_LABEL: Record<ScheduleKind, string> = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  once: '单次',
};
/** 分档 canon (02 §9.2 / r3 §9): four minute steps. Hours run 00–23. */
const MINUTE_STEPS = ['00', '15', '30', '45'];
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));

/** r3 93 line 2 per frequency; only 单次 was observed (r3 §9), the rest
 *  are [推断] from the 频率 tab words. */
const RUN_WORD: Record<ScheduleRecord['kind'], string> = {
  hourly: '每小时运行',
  daily: '每天运行',
  weekly: '每周运行',
  once: '运行一次',
};

/** 表单行盒（项目/任务 静息展示行）：表单控件同款 32px 白底发丝框。
 *  sched-form-row 别名 = #1037 e2e 跨域句柄（行结构读数/截断钉）。 */
const FORM_ROW_CLS =
  'sched-form-row flex h-8 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 shadow-xs dark:bg-input/30';

/** 行右值槽：值单行截断——超长不可断词不得撑爆 488 面板。 */
const FORM_ROW_VALUE_CLS = 'min-w-0 truncate text-ui text-foreground';

const FORM_LABEL_CLS = 'text-ui font-medium text-foreground';

/** 时/分/日期选择盒（#946 建局部壳；#952 回收进共享 Select 件；#1010 随件
 *  回源 = registry select compound 族，皮肤/几何归 registry 默认——旧
 *  SEL_TRIGGER_CLS 方角盒与 min-w-full 菜单覆写退役，ADR 0012 D1。本面只留
 *  min-w-14 布局位：两位数值 `00` 的触发盒保底宽）。语义面（触发钮 = button +
 *  aria-haspopup=listbox + aria-expanded + aria-controls→listbox、内层
 *  Select.List role=listbox、行 role=option + aria-selected、选中即关、Esc 关）
 *  全归 Base UI 原语，外点关 = 原生 outside-press（#1060 裁决①同律，穿透）。
 *  integration 面的语义钩子部分迁移（#735 教训，同 PR）：触发钮
 *  button[aria-label=时|分]（= triggerLabel，可及名 + aria-controls）与 option
 *  名零漂移；但 Base UI 把 role=listbox 放在内层 Select.List、SelectContent 的
 *  aria-label 落在 role=presentation 的外层 Popup（实测 listbox 的 aria-label
 *  恒 null），故 m5 的 `[role=listbox][aria-label]` 复合钩子迁成 `[role=listbox]`
 *  （同一时刻只开一个 select，无歧义）——pristine 件下不可达的钩子不硬留（违
 *  ADR 0012 D1）。menuLabel 仍传 SelectContent（registry 件的可及名入口，落
 *  Popup）。弹层 Portal 落 body，locator 页面级取。 */
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
  /** 触发钮上的当前值文案。 */
  label: string;
  /** listbox 的可及名。 */
  menuLabel: string;
  /** 触发钮的可及名（值形如 `00` 的纯值控件必给）。 */
  triggerLabel: string;
  onPick: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        // 本面词表无清空档（无 null item）：null 不可达，窄回 string。
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
  /** #306: opens the delete confirm (owned by the page so one dialog
   *  serves every card). */
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
      {/* kebab 菜单：registry DropdownMenu 默认皮肤（手写盘/行配方退役），
          destructive 行 = 件语义档。开合/Esc/外点关/焦点归还全归原语；
          sched-card-more/-menu/-menu-row 别名留存（dead-buttons 跨域句柄）。 */}
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

/** r3 92/92b dialog. Field values ride the fixture (project + first todo);
 *  the open tab is the scenario's capture state. M5 live 面：受控 tab/时/分、
 *  保存接真 mutation。
 *  #983 判决（居中 fixed 模态族 → Dialog）；#1037 收编 DialogShell 零皮肤
 *  适配层——家族律容器整层归壳：封顶 max-h = 100vh-48、dialog-body 真滚动
 *  区、footer 钉底、#389 焦点回陷、Esc/背板/X/取消 四路关闭（Base UI 原语
 *  承载，#67/#68 机制位）、X 钮 aria-label=t('关闭')。本面只余 488 宽度
 *  layout 位与内容；自组裸 DialogContent 的第三套容器退役（票面 c 层：旧面
 *  无封顶无滚动，900×420 实测面板 485px 上下溢出、保存钮出视口）。
 *  全受控：kind/时/分/日期与 onSave 一律由页面传入——live 与 fixture 两面
 *  都有真 handler，本组件内不存在 `live ? handler : undefined` 的死面分支
 *  （票面 a 层主因）。open/onClose 由页面持有：live 面 = formOpen 真值，
 *  fixture 面 = 冻结开屏（scenario.scheduleForm）或用户点开，关闭不销毁
 *  scenario，重载还原——deletions.ts 覆面同律。 */
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
  /** 日期档回显值；null = 未选过，落唯一候选 今天（#1037：旧
   *  onPick={() => undefined} 写死空操作退役——选择即回显）。 */
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
        {/* 项目/任务/机器三行 = 静态展示行（#1037 b 层）：r2 §6.6 只登记参考
            站预选值、picker 交互未观测（保存后列表形态原注「未测试」），
            local-first 无选择语义可挂——行显示即将生效的值，ChevronRight
            可供性暗示整族移除，静态行不得读作 picker。 */}
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
              {/* r3 92b observes 今天; further entries unrecorded——单候选，
                  故缺省值就地取 t()（每渲染现取，locale 切换自然跟上，不带
                  #74 那种「无控 select 重挂」）；选过的回显值优先。
                  不变量：回显值不进 saveSchedule* 的 at 计算——唯一候选
                  「今天」正是 at 的计算基准，接线是死逻辑。加入第二个日期
                  候选的那一天，此值必须进 wire 计算（#1037 review 钉）。 */}
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
        {/* hour at column left, minute at column center (r3 92 probe) */}
        <div className="grid grid-cols-2">
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
  // live 表单态（fixture 面另有一套镜像态，互不干扰）。
  const [formOpen, setFormOpen] = useState(false);
  // #388 fixture 冻结开屏面 + #1037 用户点开态：null = 未交互，开屏跟随
  // scenario 冻结面（scheduleForm != null 即开）；true/false = 显式开/关。
  // 局部 UI 状态，重载还原（deletions.ts 覆面同律）——Esc / 背板 / X /
  // 取消 四路关闭在冻结面上同样成立。
  const [fixtureFormOpen, setFixtureFormOpen] = useState<boolean | null>(null);
  const [formKind, setFormKind] = useState<ScheduleKind>('daily');
  const [formHour, setFormHour] = useState('09');
  const [formMinute, setFormMinute] = useState('00');
  // fixture 面表单态（#1037：冻结面同样全受控——tab/时/分/保存都有真
  // handler）；kind 初值 = scenario 冻结档（r3-92 每天 / r3-92b 单次），
  // 缺省 每天。日期回显两面共用一格（URL 决定同一时刻只有一面在场）。
  const [fixtureKind, setFixtureKind] = useState<ScheduleKind>(fixture.scheduleForm ?? 'daily');
  const [fixtureHour, setFixtureHour] = useState('09');
  const [fixtureMinute, setFixtureMinute] = useState('00');
  const [formDate, setFormDate] = useState<string | null>(null);
  const schedules = withoutDeleted(
    live ? mapSchedules(schedulesQ.data ?? []) : withCreatedSchedules(fixture.schedules ?? []),
  );
  const now = live ? Date.now() : fixture.now;
  // #306 删除确认：target 与 open 分离——退出动画期摘要行保内容（todo 删除
  // 同律），重开换 target 即换摘要。
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRecord | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const liveTodos = (todosQ.data ?? []).map(toDisplayTodo);
  const liveTodo = todosQ.data?.[0];
  const saveSchedule = () => {
    if (!liveTodo) {
      setFormOpen(false);
      return;
    }
    // at = 本地时区今日 hh:mm（02 §9.2：tz = Intl 解析值，server 侧同口径；
    // 周期档 nextRunAt 由 server computeNextRunAt 滚动，once 触发后出队）。
    const base = new Date();
    base.setHours(Number(formHour), Number(formMinute), 0, 0);
    if (formKind === 'once' && base.getTime() < Date.now()) {
      base.setDate(base.getDate() + 1); // 单次已过点 = 明日同刻 [设计]
    }
    mutations.createSchedule.mutate(
      {
        todoId: liveTodo.id,
        projectId: liveTodo.projectId,
        kind: formKind,
        at: base.getTime(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      // #638：表单提交即关（下方 setFormOpen），失败 = 定时没建上却零解释。
      { onError: (error) => toastError(t('新建定时失败，请重试。'), error) },
    );
    setFormOpen(false);
  };
  /** #1037 fixture 面保存：会话创建覆面落卡（markScheduleCreated，重载
   *  还原——删除覆面同律），不再是零结果的哑点击。记录是展示数据不是
   *  wire 真值：at = 冻结日（fixture.now 所在日）的 hh:mm，TZ_OFFSET
   *  wall-clock 口径与 hourMinute 同源；nextRunAt 按频率自 at 前滚到越过
   *  fixture.now（once 已过点 = 滚明日，live 分支同律）。[设计] 覆面档位
   *  仅此一条——原站保存后的列表形态未观测（r2 §6.6 注「未测试」）。 */
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
      // fixture canon（scheduleOnce 同款占位，卡面不渲染）。
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
        // page-new-action = overlay-focus / dead-buttons handle.
        <Button
          className={`page-new-action ${TOPBAR_PRIMARY_BUTTON}`}
          onClick={() => (live ? setFormOpen(true) : setFixtureFormOpen(true))}
        >
          <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
          {t('新建')}
        </Button>
      }
    >
      {schedules.length === 0 ? (
        // sched-empty = dead-buttons / accent-typo 跨域句柄。
        <EmptyState
          className="sched-empty mt-6"
          icon={Clock}
          title={t('尚无定时。')}
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
      {/* #1037：fixture 面恒挂载（open=false 时 Base UI 不渲染 DOM）——
          retained-mount 让退场淡出活过关闭，冻结面与用户点开面共用一壳。 */}
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
          // live = DELETE /api/schedules/:id（invalidateAll 重取）；fixture =
          // deletions 覆面（session 局部，重载还原）——todo 删除同律。
          if (live)
            mutations.deleteSchedule.mutate(deleteTarget.id, {
              // #638：确认层已关，失败 = 行还在却零解释。
              onError: (error) => toastError(t('删除定时失败，请重试。'), error),
            });
          else markDeleted(deleteTarget.id);
          setConfirmOpen(false);
        }}
      />
    </PageShell>
  );
}

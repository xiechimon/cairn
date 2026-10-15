// 机器 route (spec 11 A8, #357): one grouped card — the local machine row
// (server-host baseline, seeded at startup, pinned first, undeletable) with
// one per-runtime pi / Claude Code brand mark pair, then one row per attached
// LAN/VPS machine — then the dashed full-width 添加机器 button
// (CreateMachineDialog flow unchanged: run the same CLI on the target box).
// A7: no row carries a navigation/menu handler, so no row renders chevron or
// ellipsis affordances. The former `Pacman 托管机器` facade row is gone —
// hosted execution does not exist in the local-first architecture.
// #503: per-runtime 开关摘除，改官方品牌 mark（启用 = 品牌原色，未启用 =
// 35% 透明，read-only）。enabledRuntimes 字段与 PATCH /api/machines/{id}
// 原样保留——那是死控件（PR #507：「该字段全仓只写不读」），摘除是对的。
// XMON-113：行内接回机器层 shell 闸（machine.shellEnabled，消费方 = claim
// 组装 localTools 双闸 + 每命令预检，XMON-108 R1）。#1108 起行内活控件 =
// 两个：shell 闸 + 并发上限选择器（machine.maxConcurrent，消费方 = server
// claim 闸 + daemon 本地闸）——两者都有真实消费链，死钮纪律（删除 /
// chevron / per-runtime 开关）原样由 e2e 负向把守。
// 三态读标注（#895 起，全读态零控件；#1260 降级后语义 = 绑定 Agent 的归属
// 机事实）：「总管主机」徽标（chief 回合的归属机）、「总管回合进行中」
// （该机正在执行 chief 步）、「总管等待机器」（挂起的 pending 回合等该机
// 上线/开闸）。live 数据 = GET /chief 封套
// orchestration 块（homeMachineId + per 机 activity 计数）join 本页行集；
// fixture = MachineRow chief* 字段静态投影。chief 的归属机 = 绑定 Agent 的
// 归属机（无独立设定面），本页只有观测——「关电脑前确认编排已落在常开机器
// 上」的观测面。

import { AGENT_TOOL_SHELL, MACHINE_RUNTIMES, type MachineRuntime } from '@pacman/shared';
import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApiMutations, useChief, useMachines, useTeams } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { ClaudeMark, PiMark } from '../components/brand-marks.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Switch } from '../components/ui/switch.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { TEAM_NAME } from '../fixtures/fixtures.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, Minus, Monitor, Plus, Restore, ServerThin } from '../icons/index.js';
import { CreateMachineDialog } from './create-machine-dialog.js';
import {
  GroupCard,
  OnlineDot,
  RowGrow,
  RowLine,
  RowText,
  RowTitle,
  StatusPill,
  Tile,
} from './parts.js';
import { ResourceShell } from './shell.js';

export const MACHINES_HREF = '/app/resources/machines';

/** runtime 可读名（专有名词，双语言同形；词表单源 = shared MACHINE_RUNTIMES）。
 *  #887 起不再上屏为文字——挂在 mark 容器上做 aria-label 与 title 悬停提示。 */
const RUNTIME_LABELS: Record<MachineRuntime, string> = {
  pi: 'pi',
  'claude-code': 'Claude Code',
};

/** runtime → 官方品牌 mark。键集钉 MachineRuntime：词表扩项时此处编译期报错，
 * 不会静默退化成默认 mark。 */
const RUNTIME_MARKS: Record<MachineRuntime, typeof PiMark> = {
  pi: PiMark,
  'claude-code': ClaudeMark,
};

/** 机器层 shell 开关的说明句（#1175：不再作为行副行常驻——挂在开关簇的
 * tooltip 上，hover/focus 弹出。机器侧的那半边语义：Agent 权限 tab 的同名
 * 开关说的是「在哪台机器上能用」，这里说的是「这台机器让不让用」，两者齐开
 * 预检才放行（XMON-108 R1 双闸）。工具名经 {tool} 插值走 shared
 * AGENT_TOOL_SHELL 单源——两层开关共用同一个词，词变了不会只改一处。 */
const MACHINE_SHELL_HINT = '已授权「{tool}」的 Agent 可在该机器上执行命令。';

/** #1108 并发档位候选（UI 面 1..8——单机同刻 8 个 agent 会话已是重负载；
 * PATCH 值域 1..16 更宽，API 设的 9..16 动态并入选项，控件不谎报现值）。 */
/** 老 server（无 concurrencyRange）的退场档位。 */
const FALLBACK_RANGE = { min: 1, max: 8 };

export const CONCURRENCY_SOURCE_LABEL = {
  manual: '手动',
  measured: '推荐',
  estimate: '估算',
} as const;

function BasisRow({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-(--text-tertiary)">{label}</span>
      <span className="tabular-nums text-(--text-secondary)">{value}</span>
    </span>
  );
}

/** #1108 并发上限选择器（机器行第二个活控件，listbox 族形态
 * 的 popover listbox 正典：Button ghost 触发 + Check 选中行）。值 =
 * machine.maxConcurrent；live 选定 = PATCH /api/machines/{id}；fixture 面
 * 本地草稿（shell 开关同律——scenario 无 API，开关也是活的）。
 * #1241 设计 A：行内触发面只剩 数值 + chevron（与邻座行文本同视觉档），
 * 语义词（「并发上限」+ 来源）整体搬进 aria-label / title 与弹层——行内
 * 不再出现 并发 标签词与 推荐/手动/估算 来源词。 */
function MachineConcurrencySelect({
  machine,
  value,
  onPick,
  onReset,
}: {
  machine: MachineRow;
  value: number;
  onPick: (n: number) => Promise<unknown> | undefined;
  onReset: () => Promise<unknown> | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // #1241 弹性区间：server 按总内存给 1..max（单源公式在 dispatch-eligibility）。
  // 现值超出区间（API 设的 / 换机后内存变小）→ 照实显示并标「超出」，不谎报；
  // 新输入一律夹进区间（失焦 / Enter / 步进时提交，Esc 还原不提交）。
  const range = machine.concurrencyRange ?? FALLBACK_RANGE;
  const outOfRange = value < range.min || value > range.max;
  // #1342 Bugbot：只有用户真改过草稿（dirty）才在 Enter / 失焦时提交——未编辑的
  // 超区间现值不许被夹值存成手动；未改时草稿跟随现值（弹层开着时心跳改值也同步）。
  // #1346 Bugbot：写在途时（PATCH 串行排队、缓存尚未更新）下一次 ± / Enter 的
  // 基数取「最后一次请求的值」而非旧 value，草稿也不回弹到旧值；队列清空后回到 value。
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const inFlight = useRef(0);
  const current = pendingTarget ?? value;
  const track = (target: number | null, req: Promise<unknown> | undefined) => {
    if (!req) return;
    inFlight.current += 1;
    setPendingTarget(target);
    void req.finally(() => {
      inFlight.current -= 1;
      if (inFlight.current === 0) setPendingTarget(null);
    });
  };
  const send = (n: number) => track(n, onPick(n));
  const [draft, setDraft] = useState(String(current));
  const [dirty, setDirty] = useState(false);
  const skipCommit = useRef(false);
  useEffect(() => {
    if (!dirty) setDraft(String(current));
  }, [current, dirty]);
  const clampTo = (n: number) => Math.min(range.max, Math.max(range.min, n));
  const settle = (n: number) => {
    setDraft(String(n));
    setDirty(false);
  };
  const commit = () => {
    if (!dirty) return;
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      settle(current);
      return;
    }
    const next = clampTo(parsed);
    settle(next);
    if (next !== current) send(next);
  };
  // ± = 单次写：基数取草稿（改过）或现值，步进后夹值，直接一发 PATCH。
  const step = (delta: number) => {
    const parsed = Number.parseInt(draft, 10);
    const base = dirty && !Number.isNaN(parsed) ? parsed : current;
    const next = clampTo(clampTo(base) + delta);
    settle(next);
    if (next !== current) send(next);
  };
  // ± / 恢复推荐 按下时不让输入框失焦（失焦提交会先发一笔手动值，与本次动作竞态）。
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();
  const recommended = machine.recommendedConcurrent;
  const hardware = machine.capabilities?.hardware;
  const source = machine.concurrencySource;
  const estimate = source === 'estimate';
  const overridden = machine.maxConcurrentOverridden === true;
  // aria-label / title 单源：来源缺席（老 server / 存量 fixture）退无来源段
  // 的短形——退场判据与行内呈现同律，不谎报不存在的来源。
  const label =
    source !== undefined
      ? t('并发上限 {n}，{source}', { n: value, source: t(CONCURRENCY_SOURCE_LABEL[source]) })
      : t('并发上限 {n}', { n: value });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          settle(current);
          skipCommit.current = false;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            // aria-label = e2e 一级载体（shell 开关同律，strict-mode 独立命名）；
            // data-concurrency-source = 来源状态载体——原行内来源词 span 的
            // 载体随可见词迁入触发钮（#1241 设计 A）。
            aria-label={label}
            title={label}
            data-machine-id={machine.id}
            data-testid="machine-concurrency"
            data-concurrency-source={source}
            className="h-6 w-10 cursor-pointer justify-between gap-1 rounded-md px-1.5 text-xs leading-4 font-normal text-(--text-tertiary) hover:bg-(--surface-hover) active:not-aria-[haspopup]:translate-y-0"
          />
        }
      >
        <span className="tabular-nums">{value}</span>
        <ChevronDown width={11} height={11} className="flex-none" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        aria-label={t('并发上限')}
        className="w-52 rounded-lg bg-(--popover) p-1.5 shadow-(--chief-shadow)"
      >
        <div className="flex items-baseline justify-between px-1">
          <span className="text-xs leading-4 text-(--text-tertiary)">{t('并发上限')}</span>
          <span className="text-sm leading-5 font-medium tabular-nums text-(--foreground)">
            {value}
          </span>
        </div>
        {/* #1241 设计 A：来源词（推荐/手动/估算）只在弹层上屏——行内触发面
            不再携带，读法随 aria-label / title 可达。 */}
        {source !== undefined && (
          <div className="px-1 text-xs leading-4 text-(--text-tertiary)">
            {t(CONCURRENCY_SOURCE_LABEL[source])}
          </div>
        )}
        <div className="flex items-center gap-1 px-1 py-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('减少并发上限')}
            data-testid="machine-concurrency-dec"
            disabled={current <= range.min && Number.parseInt(draft, 10) <= range.min}
            className="size-7 cursor-pointer rounded-md text-(--text-secondary) hover:bg-(--surface-hover)"
            data-concurrency-action="step"
            onMouseDown={keepFocus}
            onClick={() => step(-1)}
          >
            <Minus width={12} height={12} />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            role="spinbutton"
            aria-label={t('并发上限')}
            aria-valuemin={range.min}
            aria-valuemax={range.max}
            aria-valuenow={value}
            aria-describedby={`concurrency-hint-${machine.id}`}
            min={range.min}
            max={range.max}
            data-testid="machine-concurrency-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                skipCommit.current = true;
                settle(current);
              }
            }}
            onBlur={(e) => {
              // 焦点去往 ± / 恢复推荐（键盘 Tab 也算）：由该动作单发 PATCH，失焦不提交。
              const to = e.relatedTarget as HTMLElement | null;
              if (skipCommit.current || to?.dataset.concurrencyAction !== undefined) {
                skipCommit.current = false;
                return;
              }
              commit();
            }}
            className="h-7 flex-1 [appearance:textfield] rounded-md px-1 text-center text-sm tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('增加并发上限')}
            data-testid="machine-concurrency-inc"
            disabled={current >= range.max && Number.parseInt(draft, 10) >= range.max}
            className="size-7 cursor-pointer rounded-md text-(--text-secondary) hover:bg-(--surface-hover)"
            data-concurrency-action="step"
            onMouseDown={keepFocus}
            onClick={() => step(1)}
          >
            <Plus width={12} height={12} />
          </Button>
        </div>
        <div
          id={`concurrency-hint-${machine.id}`}
          data-testid="machine-concurrency-hint"
          className="px-1 pb-1 text-xs leading-4 text-(--text-tertiary)"
        >
          {t(estimate ? '可选 {min}–{max}（默认档位）' : '可选 {min}–{max}（按内存）', range)}
          {recommended !== undefined && ` · ${t('推荐 {n}', { n: recommended })}`}
          {outOfRange && (
            <span data-testid="machine-concurrency-out-of-range" className="block">
              {t('当前值 {n} 超出可选范围', { n: value })}
            </span>
          )}
        </div>
        {(estimate || hardware?.memoryTotalMb !== undefined) && (
          <div
            className="flex flex-col gap-1 px-1 text-xs leading-4"
            data-testid="machine-concurrency-basis"
          >
            {estimate ? (
              <span className="text-(--text-tertiary)">
                {t('未收到能力指纹，按保守默认 {n} 估算', { n: recommended ?? value })}
              </span>
            ) : null}
            {estimate ? null : (
              <>
                {hardware !== undefined && hardware.memoryTotalMb !== undefined && (
                  <>
                    <BasisRow label={t('核数')} value={String(hardware.cpuCores)} />
                    <BasisRow
                      label={t('总内存')}
                      value={`${(hardware.memoryTotalMb / 1024).toFixed(1)} GiB`}
                    />
                    <BasisRow label={t('负载')} value={hardware.loadAvg1.toFixed(2)} />
                  </>
                )}
              </>
            )}
          </div>
        )}
        {overridden && (
          <Button
            variant="ghost"
            data-testid="machine-concurrency-reset"
            data-concurrency-action="reset"
            onMouseDown={keepFocus}
            className="h-7 cursor-pointer justify-start gap-1.5 rounded-md px-1 text-xs font-normal text-(--text-secondary) hover:bg-(--surface-hover) active:not-aria-[haspopup]:translate-y-0"
            onClick={() => {
              setDirty(false);
              setOpen(false);
              track(recommended ?? null, onReset());
            }}
          >
            <Restore width={12} height={12} className="flex-none text-(--text-tertiary)" />
            {t('恢复推荐')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** #1241 能力读标注全文（title / aria-label）：行内只露紧凑短标。 */
function capabilityFull(
  t: ReturnType<typeof useI18n>['t'],
  caps: { mcpServers: unknown[]; skills: unknown[] } | null,
): string {
  return caps === null
    ? t('能力清单未上报')
    : t('MCP {n} · 本机技能 {m}', { n: caps.mcpServers.length, m: caps.skills.length });
}

export function MachinesPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  // M5 live：GET teams/{id}/machines（machine_presence SSE 联动失效）。
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  // #895 orchestration 读面：live = chief 封套块（无效数据 = 无标注，页面
  // 不等 chief 查询——标注是增量信息，查询未决时行照常渲染）；fixture = 行
  // 字段（chiefHost / chiefRunning / chiefWaiting）静态投影。
  const chiefQ = useChief(teamId, live);
  const orchestration = live ? chiefQ.data?.orchestration : undefined;
  const activityOf = (machineId?: string) =>
    orchestration?.activity.find((a) => a.machineId === machineId);
  const chiefState = (
    machine: MachineRow,
  ): { host: boolean; running: boolean; waiting: boolean } =>
    live
      ? {
          host: orchestration?.homeMachineId === machine.id,
          running: (activityOf(machine.id)?.running ?? 0) > 0,
          waiting: (activityOf(machine.id)?.waiting ?? 0) > 0,
        }
      : {
          host: machine.chiefHost === true,
          running: machine.chiefRunning === true,
          waiting: machine.chiefWaiting === true,
        };
  // wayfinder #181: res-add 钮开 添加机器 dialog（r2 11b CLI 两步表单，
  // #179 裁决）；团队名插值同 team-page 律（live = GET /api/teams，
  // fixture = TEAM_NAME 常量），teamId 内嵌 API key 命令
  const teamsQ = useTeams(live);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? TEAM_NAME) : TEAM_NAME;
  const [addOpen, setAddOpen] = useState(false);
  const mutations = useApiMutations(teamId);

  const rowKey = (machine: MachineRow): string => machine.id ?? machine.name;

  // shell 开关态：live 面由记录驱动（mutation 的乐观写落在 ['machines'] 缓存
  // 上），fixture 面（scenario 数据源，无 API）落本地草稿——两态同形，fixture
  // 面的开关因此也是活的，不是演示死钮。
  const [shellDraft, setShellDraft] = useState<Record<string, boolean>>({});
  const shellOn = (machine: MachineRow): boolean =>
    shellDraft[rowKey(machine)] ?? machine.shellEnabled ?? false;
  const toggleShell = (machine: MachineRow, on: boolean): void => {
    if (!live || machine.id == null) {
      setShellDraft((prev) => ({ ...prev, [rowKey(machine)]: on }));
      return;
    }
    mutations.patchMachine.mutate({ id: machine.id, body: { shellEnabled: on } });
  };
  // #1108 并发上限：与 shell 开关同一 mutation/草稿两态律。字段缺席（老
  // server / 存量 fixture）= 控件与读标注整组退场（maxConcurrent undefined
  // 判据），行回到 shell 单控件面。
  const [capDraft, setCapDraft] = useState<Record<string, number>>({});
  const capOn = (machine: MachineRow): number =>
    capDraft[rowKey(machine)] ?? machine.maxConcurrent ?? 1;
  // #1342 Bugbot：同一台机器的并发写按序发——后一笔等前一笔回执再发，服务端
  // 落库顺序 = 用户意图顺序（最后一次意图胜出），不会乱序留下覆盖位。
  const capChain = useRef<Record<string, Promise<unknown>>>({});
  const patchCap = (id: string, maxConcurrent: number | null): Promise<unknown> => {
    const prev = capChain.current[id] ?? Promise.resolve();
    const next = prev.then(() =>
      mutations.patchMachine.mutateAsync({ id, body: { maxConcurrent } }).catch(() => undefined),
    );
    capChain.current[id] = next;
    return next;
  };
  const pickCap = (machine: MachineRow, n: number): Promise<unknown> | undefined => {
    if (!live || machine.id == null) {
      setCapDraft((prev) => ({ ...prev, [rowKey(machine)]: n }));
      return;
    }
    return patchCap(machine.id, n);
  };
  const resetCap = (machine: MachineRow): Promise<unknown> | undefined => {
    if (!live || machine.id == null) {
      setCapDraft((prev) => ({
        ...prev,
        [rowKey(machine)]: machine.recommendedConcurrent ?? machine.maxConcurrent ?? 1,
      }));
      return;
    }
    return patchCap(machine.id, null);
  };
  // 保存失败的显式反馈（XMON-80/P2 同律）：本面无 toast，失败只可能来自
  // shell 开关 / 并发选择这两条写（页面仅有的 mutation），文案是固定句、
  // 不透传 server 原文。
  const shellSaveFailed =
    mutations.patchMachine.isError &&
    mutations.patchMachine.variables?.body.shellEnabled !== undefined;
  const capSaveFailed =
    mutations.patchMachine.isError &&
    mutations.patchMachine.variables?.body.maxConcurrent !== undefined;

  return (
    // r7 06: the machines topbar carries no `+ 新建` — the dashed 添加机器
    // button is the page's only add action
    <ResourceShell
      title="机器"
      href={MACHINES_HREF}
      backHref="/app"
      selected={MACHINES_HREF}
      hideNew
      fixture={fixture}
    >
      {(shellSaveFailed || capSaveFailed) && (
        <p className="mt-0 mb-2 text-xs leading-4 text-(--destructive)" role="alert">
          {t('保存失败，请重试。')}
        </p>
      )}
      <GroupCard>
        {machines.map((machine, i) => {
          const chief = chiefState(machine);
          return (
            <RowGrow
              divided={i > 0}
              key={rowKey(machine)}
              data-machine-id={machine.id}
              data-kind={machine.kind ?? 'remote'}
            >
              <Tile Icon={Monitor} size="lg" tone="orange" />
              <RowText>
                <RowLine>
                  <RowTitle>
                    {/* #1259：机器名 = 详情页入口（行内开关控件不动，整行不
                        改链接——控件与导航分家）。 */}
                    <Link to={`${MACHINES_HREF}/${machine.id}?${searchParams.toString()}`}>
                      {t(machine.name)}
                    </Link>
                  </RowTitle>
                  {/* online 读 machine.online（与 new-task-machine-dot /
                    dlg-machine-dot 同族语义）：在线绿点，离线灰点——离线行
                    此前无任何表示，daemon 死后机器页看不出。undefined（无该
                    字段的旧 fixture）保持不渲染，存量 capture 零漂移。
                    data-on 是状态载体（#910 裁定 3）。 */}
                  {machine.online !== undefined && <OnlineDot on={machine.online !== false} />}
                </RowLine>
              </RowText>
              {machine.kind === 'local' ? (
                <span className="ml-auto flex items-center gap-4">
                  {MACHINE_RUNTIMES.map((runtime) => {
                    const on = (machine.enabledRuntimes ?? []).includes(runtime);
                    const Mark = RUNTIME_MARKS[runtime];
                    return (
                      // #887 图标独形：文字名撤下，可辨识性不跟着删——容器
                      // role="img" + aria-label 给读屏报名字，title 给悬停提示。
                      // mark 仍是装饰（aria-hidden）；on/off 两态由 mark 的
                      // 实色/35% 透明承载（enabledRuntimes 全仓只写不读，#503），
                      // data-enabled 是状态断言载体（原 .mach-runtime--on 修饰类；
                      // 不叫 data-on——那是行内在线点 OnlineDot 的既有载体，
                      // 两者同屏，名字撞了选择器就分不开）。
                      <span
                        className="flex items-center"
                        key={runtime}
                        data-runtime={runtime}
                        data-enabled={on}
                        role="img"
                        aria-label={RUNTIME_LABELS[runtime]}
                        title={RUNTIME_LABELS[runtime]}
                      >
                        <Mark
                          className={cn('block flex-none', on ? 'opacity-100' : 'opacity-35')}
                        />
                      </span>
                    );
                  })}
                </span>
              ) : (
                machine.pill != null && <StatusPill label={machine.pill} />
              )}
              {/* #895 三态读标注（A8）：纯文本/badge 读态——无 handler、无
                button、无 menu（行内活控件纪律仍 = shell 闸恰一个）。
                margin-left:auto 同 StatusPill 律：本地行 runtimes 已吃 auto
                时贴其右，远端行自己撑到行右。状态行行首点只作装饰（aria
                语义在文案），等待灰点与离线灰点同色——「在等谁」与「机器
                在不在线」是两个正交事实，别用颜色再表达一遍。 */}
              {(chief.host || chief.running || chief.waiting) && (
                <span className="ml-auto flex flex-none items-center gap-2">
                  {chief.host && (
                    <Badge variant="outline" data-orchestration="host">
                      {t('总管主机')}
                    </Badge>
                  )}
                  {chief.running && (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs leading-4 whitespace-nowrap text-(--text-tertiary) before:block before:size-1.5 before:rounded-full before:bg-(--col-dot-done) before:content-['']"
                      data-orchestration="running"
                    >
                      {t('总管回合进行中')}
                    </span>
                  )}
                  {chief.waiting && (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs leading-4 whitespace-nowrap text-(--text-tertiary) before:block before:size-1.5 before:rounded-full before:bg-(--col-dot-idle) before:content-['']"
                      data-orchestration="waiting"
                    >
                      {t('总管等待机器')}
                    </span>
                  )}
                </span>
              )}
              {/* 机器层 shell 闸（XMON-113）：唯一行内控件。label 与副文案同
                词（AGENT_TOOL_SHELL）——两层授权共用一套词汇，用户在 Agent
                权限 tab 看到的是同一个词。与左侧 runtime mark / status pill
                之间留 20px——mark 是展示、开关是控件，贴太近会被读成同一组
                （#503 摘 mark 的歧义正是「这是不是又在开关 runtime」）；
                行内无 mark 无 pill 时（接入机未观测态）自己撑到右缘。
                #1175：说明句挂 tooltip（hover/focus 弹出，不再常驻副行）——
                触发面 = 开关簇整体（词 + 开关，词是 aria-label/可见词，键盘
                Tab 到开关时说明随 focus 可达）。 */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      data-machine-col="shell"
                      className={cn(
                        'flex flex-none items-center gap-2',
                        machine.kind === 'local' || machine.pill != null ? 'ml-5' : 'ml-auto',
                      )}
                    />
                  }
                >
                  <span className="text-xs leading-4 whitespace-nowrap text-(--text-tertiary)">
                    {t(AGENT_TOOL_SHELL)}
                  </span>
                  <Switch
                    data-machine-id={machine.id}
                    aria-label={t(AGENT_TOOL_SHELL)}
                    checked={shellOn(machine)}
                    onCheckedChange={(on) => toggleShell(machine, on)}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {t(MACHINE_SHELL_HINT, { tool: t(AGENT_TOOL_SHELL) })}
                </TooltipContent>
              </Tooltip>
              {/* #1108 并发面（读标注 + 上限选择器）：字段缺席 = 整组退场。
                  读标注 = 该机 claimed 步数 / 上限（`执行中 n/N`——全 kind 计
                  数，与 server 闸 / 排队投影同源同数）；数据随 machine_presence
                  / step SSE 失效重取刷新（machines 查询联动）。与 shell 簇同
                  ml-5 间距：两组控件视觉同档。 */}
              {machine.maxConcurrent !== undefined && (
                <span
                  className="ml-5 flex flex-none items-center gap-2.5"
                  data-machine-col="concurrency"
                >
                  {machine.runningSteps !== undefined && (
                    <span
                      className="w-16 text-xs leading-4 whitespace-nowrap tabular-nums text-(--text-tertiary)"
                      data-machine-running={machine.runningSteps}
                    >
                      {t('执行中 {n}/{cap}', {
                        n: machine.runningSteps,
                        cap: capOn(machine),
                      })}
                    </span>
                  )}
                  <MachineConcurrencySelect
                    machine={machine}
                    value={capOn(machine)}
                    onPick={(n) => pickCap(machine, n)}
                    onReset={() => resetCap(machine)}
                  />
                </span>
              )}
              {/* #1251 能力清单读标注（daemon 上报的已装 MCP slug 数 + 本机
                  技能数；null = 从未上报——「未上报」与「报了空集」是两态，
                  前者闭嘴后者如实）。字段缺席（老 server / 存量 fixture）=
                  整组退场，呈现零漂移（maxConcurrent 同律）。 */}
              {machine.capabilities !== undefined && (
                <span
                  className="ml-5 w-24 flex-none truncate text-right text-xs leading-4 whitespace-nowrap text-(--text-tertiary)"
                  data-machine-capabilities={
                    machine.capabilities === null ? 'unreported' : 'reported'
                  }
                  title={capabilityFull(t, machine.capabilities)}
                >
                  <span className="sr-only">{capabilityFull(t, machine.capabilities)}</span>
                  <span aria-hidden="true">
                    {machine.capabilities === null
                      ? '—'
                      : t('MCP {n} · 技能 {m}', {
                          n: machine.capabilities.mcpServers.length,
                          m: machine.capabilities.skills.length,
                        })}
                  </span>
                </span>
              )}
            </RowGrow>
          );
        })}
      </GroupCard>
      {/* dashed 全宽 添加机器 钮（r7 06 语义 = 空位添加行）：#1005 registry
          对齐——Button outline 默认档（h-8 / rounded-lg / hover bg-muted），
          dashed 边式是唯一语义补充（registry 无 dashed 档）。 */}
      <Button
        variant="outline"
        className="mt-4 w-full border-dashed"
        onClick={() => setAddOpen(true)}
      >
        <ServerThin />
        {t('添加机器')}
      </Button>
      <CreateMachineDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teamName={teamName}
        teamId={teamId}
      />
    </ResourceShell>
  );
}

// 总管设置 view (issue #72, r5 101–104): the gear swaps the whole content
// area to this surface — back button + centered title over a 766-wide
// centered column with the 4 tabs (Agent / 章程 / 记忆 / 关注与提醒). The
// tab row is real state; fixture captures take the fixture's tab.
// #182 三钮接线:agent 行 = 选择总管 Agent dialog(清单 = members 读面
// memberType:"agent" 行,r5 §1;选定 → PATCH chief agent 槽,换绑带二次
// 确认 canon);章程编辑 = DialogShell 编辑弹窗(#180 裁决;保存 → PATCH
// charter 槽)。#1260 总管降级:chief 不再持模型/机器覆盖槽——Agent tab
// 一张只读信息卡说明「模型与归属机跟随绑定 Agent」并回显其值,改动去
// Agent 设置面/机器详情页。#903(ADR 0014):派发不设槽——先规划/直接修
// 由 chief 逐次派发自行判定(run_builds withPlan + dispatchReason 回执),
// settings 无「派发方式」行。

import { MEMORY_EMPTY_COPY, MEMORY_QUOTA_PER_AGENT } from '@pacman/shared';
import { useState } from 'react';
import { useApiMutations, useChief, useMachines, useMembers, useMemories } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import type { ChiefContent, ChiefSettingsTab, MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight, ChiefFaceDashed } from '../icons/index.js';
import { ChiefAgentDialog, type ChiefAgentOption } from './chief-agent-dialog.js';
import { EditCharterDialog } from './edit-charter-dialog.js';

const TABS: { id: ChiefSettingsTab; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'charter', label: '章程' },
  { id: 'memory', label: '记忆' },
  { id: 'watches', label: '关注与提醒' },
];

/** 设置面卡片族公共皮肤（#950 清零，旧 .chief-compress/.chief-host 等值：
 *  surface-secondary 块 / 16 横垫 8 纵垫 / min-height 62——#772 律英文描述
 *  换行时长高 / 17 上距）。圆角接 registry Card 依据 rounded-xl（#1054
 *  消费点清点，ADR 0012 D1；卡族三成员 CARD/EMPTY_CARD/LIST_CARD 与章程块
 *  同档，8px 一次性档随「几何自由」授权废止收敛回 registry 默认）。 */
const CARD_CLS =
  'mt-[17px] flex min-h-[62px] items-center gap-4 rounded-xl bg-(--secondary) px-4 py-2';

/** 卡片文字组（旧 .chief-compress-text h3/p 等值）。 */
const CARD_TITLE_CLS = 'text-sm font-semibold text-(--foreground)';
const CARD_DESC_CLS = 'mt-0.5 text-xs text-(--text-tertiary)';

/** 空态卡（旧 .chief-memo/.chief-watches 等值，#772 min-height + 居中 +
 *  tertiary 统一律；圆角随卡族 = registry Card rounded-xl，#1054）。 */
const EMPTY_CARD_CLS =
  'mt-[17px] flex min-h-11 items-center justify-center rounded-xl bg-(--secondary) px-4 py-2 text-[13px] text-(--text-tertiary)';

/** 列表卡（旧 .chief-memory-card/.chief-watch-card 等值，XMON-117 一卡多行
 *  律；8px 一次性档收敛回 registry Card rounded-xl，#1054，ADR 0012 D1）。 */
const LIST_CARD_CLS = 'mt-[17px] rounded-xl bg-(--secondary) text-[13px]';

/** tab chip（#950 清零，旧 .chief-tab 等值：26 高 / 11 横垫 / 13px 次级墨 /
 *  透明底，圆角骑件默认 trigger 档 rounded-md（#1054）；z-[1] 压在滑动
 *  指示条之上）。选中态载体 = aria-selected
 *  （Base UI 自带，#910 裁定 3——旧 .is-active 类退役）：primary 墨 + 600。
 *  hover tint 只给未选中 chip、只吃精细指针（#73/#138 律）；过渡只动
 *  background-color（旧律：选中墨切换瞬切不过渡）。
 *  尾段 = 上游基类中和层（#1003，bare 档退役后 chip 骑 registry default 档
 *  trigger）：font-medium → 400；hover 墨提亮钉回次级墨（只打未选中，选中
 *  chip 的墨由 aria-selected 段承载）；data-active 漆面/阴影中和为透明——
 *  选中底色由滑动指示条（TAB_INDICATOR_CLS，z-0）承载，chip 本体恒透明。 */
const TAB_CLS =
  'relative z-[1] h-[26px] cursor-pointer border-none bg-transparent px-[11px] text-[13px] text-(--text-secondary) transition-[background-color] duration-(--dur-fast) ease-(--ease-standard) pointer-fine:hover:aria-[selected=false]:bg-(--seg-hover) aria-selected:font-semibold aria-selected:text-(--foreground) font-normal hover:aria-[selected=false]:text-(--text-secondary) dark:hover:aria-[selected=false]:text-(--text-secondary) data-active:bg-transparent data-active:shadow-none dark:data-active:bg-transparent';

/** 滑动指示条（#644，旧 .chief-tab-indicator 等值）：Base UI 把激活 chip 的
 *  几何写进内联 --active-tab-* 自定义属性，pill 垫在 chip 下层（z-0）按
 *  参考站实测过渡滑动——left/top/width/height 各 150ms ease（todos.dev 真
 *  浏览器实测，ease 即 cubic-bezier(0.25,0.1,0.25,1)，非 --ease-standard）。
 *  transition 走任意值 shorthand 而非 transition-[…] + duration 拆件：四条
 *  逐属性声明的 computed 读回是 4 元列表（'0.15s, 0.15s, 0.15s, 0.15s' /
 *  'ease, ease, ease, ease'），segmented-controls 探针按旧 CSS 逐字钉该形。
 *  减弱动效瞬切（r1 §4.3 全站降级律，motion-reduce 承旧 reduce 块）。
 *  pill 圆角接 registry Tabs trigger 档 rounded-md（#1054 清点：#644 判决
 *  「pill shape carried by consumer CSS」的 shape 归件默认词汇；与 lg 列表
 *  p-0.5 内衬成同心圆角 10−2=8px）。 */
const TAB_INDICATOR_CLS =
  'pointer-events-none absolute left-(--active-tab-left) top-(--active-tab-top) z-0 h-(--active-tab-height) w-(--active-tab-width) rounded-md bg-(--chief-tab-active) shadow-[0_1px_2px_0_rgb(0_0_0/0.05)] [transition:left_var(--dur-fast)_ease,top_var(--dur-fast)_ease,width_var(--dur-fast)_ease,height_var(--dur-fast)_ease] motion-reduce:[transition:none]';

/** 已绑定 Agent 行头像（旧 .chief-agent-row-avatar 等值：首字母 chip =
 *  24 圆盘 surface 底 + 墨线框；--img 律去 chip 底边，图即圆盘）。 */
const ROW_AVATAR_CLS =
  'grid size-6 flex-none place-items-center rounded-full border border-(--border) bg-(--card) text-xs text-(--foreground)';
const ROW_AVATAR_IMG_CLS =
  'grid size-6 flex-none place-items-center rounded-full border-none bg-none [&_img]:block [&_img]:size-6 [&_img]:rounded-full';

export function ChiefSettings({
  chief,
  onBack,
  machines,
}: {
  chief: ChiefContent;
  onBack: () => void;
  /** #895 fixture 面的机器行集（resources machines 投影；live 面本组件
   *  自取 useMachines，不吃本 prop）。 */
  machines?: MachineRow[];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ChiefSettingsTab>(chief.tab ?? 'agent');
  // #182 live 数据面(查询 enabled=live,fixture 面全惰性,零请求
  // 保证不动):charter/绑定 Agent = chief 封套真值;候选 Agent 集 =
  // members 读面投影。
  const { live, teamId } = useLiveData();
  const chiefQ = useChief(teamId, live);
  const membersQ = useMembers(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mutations = useApiMutations(teamId);
  const charter = live ? (chiefQ.data?.chief.charter ?? '') : '';
  const boundAgent =
    live && chiefQ.data?.agentActor != null
      ? {
          id: chiefQ.data.agentActor.id,
          name: chiefQ.data.agentActor.displayName,
          avatarUrl: chiefQ.data.agentActor.avatarUrl,
        }
      : null;
  const agentOptions: ChiefAgentOption[] | undefined = live
    ? (membersQ.data ?? [])
        .filter((m) => m.memberType === 'agent')
        .map((m) => {
          const actor = m.actor as { displayName?: string; avatarUrl?: string | null } | undefined;
          return {
            id: m.actorId,
            name: actor?.displayName ?? m.actorId,
            avatarUrl: actor?.avatarUrl ?? null,
          };
        })
    : undefined;
  const [agentOpen, setAgentOpen] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);
  // #811: 记忆 tab 读绑定 Agent 的记忆集（agent-detail 同源 useMemories；
  // 未绑定不请求，判据与 Agent 面 boundAgent 同源——误报未选即源于此）。
  const memoriesQ = useMemories(teamId, boundAgent?.id, live && boundAgent != null);
  const memories = memoriesQ.data ?? [];
  // #811: 关注 tab 读 chief 封套 watches/wakes（派工自动 watch、settle 后
  // 自动解；手动取关无服务端 mutation，故本面只读——见报告）。
  const watches = live ? (chiefQ.data?.watches ?? []) : [];
  const wakes = live ? (chiefQ.data?.wakes ?? []) : [];
  // live 提交 = PATCH chief(父侧 onSuccess 关窗,create-secret 同律);
  // fixture 面 callbacks 缺省 → dialog 走 accept 律(提交即关)。
  const bindAgent = live
    ? (agentId: string) =>
        mutations.patchChief.mutate(
          { agent: { agentId } },
          { onSuccess: () => setAgentOpen(false) },
        )
    : undefined;
  const saveCharter = live
    ? (value: string) =>
        mutations.patchChief.mutate({ charter: value }, { onSuccess: () => setCharterOpen(false) })
    : undefined;
  // #1260 只读信息行：绑定 Agent 的模型与归属机（chief 的步跟着它走）——
  // live 回显真值;改动落 Agent 设置面/机器详情页,本面不设写位。
  const boundMachineId = live ? (chiefQ.data?.agentActor?.machineId ?? null) : null;
  const boundModelId = live ? (chiefQ.data?.agentActor?.modelId ?? null) : null;
  const boundMachineName =
    boundMachineId !== null
      ? ((live ? (machinesQ.data ?? []) : (machines ?? [])).find((m) => m.id === boundMachineId)
          ?.name ?? null)
      : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="relative flex h-[57px] flex-none items-center">
        {/* XMON-23→#950：ghost/icon 原语；28×28 + 方角 + tertiary 墨（含
            hover 增亮承旧 btn--icon 皮肤）改挂 utility 等值；ghost 的灰底
            hover / expanded 涂底逐通道钉回透明（旧 per-face 无底色）。 */}
        <Button
          variant="ghost"
          size="icon"
          className="ml-3.5 size-7 cursor-pointer rounded-none border-none text-(--text-tertiary) hover:bg-transparent hover:text-(--text-secondary) dark:hover:bg-transparent dark:hover:text-(--text-secondary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0"
          aria-label={t('返回')}
          onClick={onBack}
        >
          <ChevronLeft width={16} height={16} />
        </Button>
        {/* 标题 = 全宽绝对定位覆盖层；pointer-events-none 放行到底层返回钮
            （#811：纯文本标题不需要命中测试，布局/绘制零变化）。 */}
        <h1 className="pointer-events-none absolute inset-x-0 text-center text-[15px] font-semibold text-(--foreground)">
          {t('总管设置')}
        </h1>
      </header>
      {/* #1032：面板体自持滚动（secondary/shell.tsx:92、resources/shell.tsx:121
          同律）——根与内容列此前全链 overflow visible，长内容（记忆列表/长
          章程/关注清单）被外壳 overflow-hidden 裁掉且滚轮不动。全宽滚动层
          承接 overflow（滚动条贴面板右缘），766px 窄列只在里面居中、不自滚；
          overflow-x 保持裁切：窄列内容不该横向溢出（页面壳仍是唯一裁切者）。 */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-[766px]">
          {/* XMON-23 收编：Tabs 件——原语只出语义（role=tablist/tab、
            aria-selected、roving tabindex），几何/配色/选中态由
            TAB_CLS/TAB_INDICATOR_CLS utility 承载；选中态载体 =
            aria-selected（旧 is-active 类退役，e2e 钉 role=tab+selected）。
            #1003 起 bare 档退役：骑 registry default 档，上游基类穿透由
            TAB_CLS 尾段中和。根 contents 出树，不产生布局盒。 */}
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as ChiefSettingsTab)}
            className="contents"
          >
            <TabsList className="relative inline-flex bg-(--secondary) p-0.5 group-data-horizontal/tabs:h-auto">
              {/* #644 滑动指示条：选中 chip 的底色不再画在 chip 上，改由这根
                pill 承载——切 tab 时它按参考站实测的过渡滑到新位并变宽。 */}
              <TabsIndicator data-testid="chief-tab-indicator" className={TAB_INDICATOR_CLS} />
              {TABS.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className={TAB_CLS}>
                  {t(item.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {tab === 'agent' && (
            <>
              {/* XMON-23→#950：ghost 原语 + 行卡皮肤 utility（旧
                .chief-agent-row 等值：44 行 / 12 gap / 16 横垫 /
                surface-secondary 底 / 14px 次级墨）。中和件沿旧：
                justify-start（原语居中会破左对齐行）、font-normal、
                leading-normal（原语 text-sm 的 20px 定值行高会替掉继承的
                1.5=21px，行内名字垂直挪 0.5px——像素对拍实测出在名字 AA
                上）、active 位移、hover/expanded 涂底钉回卡片底（旧
                per-face 恒压件层无反馈）、svg size-auto（ChiefFaceDashed
                24 / ChevronRight 14 属性尺寸）+ 行首 svg tertiary 墨。 */}
              <Button
                variant="ghost"
                className="mt-[17px] h-11 w-full cursor-pointer justify-start gap-3 border-none bg-(--secondary) px-4 text-sm leading-normal font-normal text-(--text-secondary) hover:bg-(--secondary) hover:text-(--text-secondary) dark:hover:bg-(--secondary) dark:hover:text-(--text-secondary) aria-expanded:bg-(--secondary) aria-expanded:text-(--text-secondary) active:not-aria-[haspopup]:translate-y-0 [&_svg:first-child]:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto"
                onClick={() => setAgentOpen(true)}
              >
                {boundAgent != null ? (
                  boundAgent.avatarUrl != null ? (
                    /* #811: 已绑定行接 agentActor.avatarUrl（封套自带，不新增
                      请求；XMON-105 --img 律：图即 24 圆盘，去 chip 底边）。 */
                    <span className={ROW_AVATAR_IMG_CLS}>
                      <SeededAvatar
                        className="size-6"
                        name={boundAgent.name}
                        src={boundAgent.avatarUrl}
                        fallback="/avatar-robot-1.svg"
                      />
                    </span>
                  ) : (
                    <span className={ROW_AVATAR_CLS}>{boundAgent.name.charAt(0)}</span>
                  )
                ) : (
                  <ChiefFaceDashed width={24} height={24} />
                )}
                <span>{boundAgent != null ? boundAgent.name : t('未设置')}</span>
                <ChevronRight width={14} height={14} className="ml-auto text-(--text-tertiary)" />
              </Button>
              {/* #1260：模型与归属机是绑定 Agent 的自身配置（chief 无覆盖
                槽）——只读回显 + 指路，写位在 Agent 设置面/机器详情页。 */}
              <div className={CARD_CLS} data-testid="chief-follows-agent">
                <div>
                  <h3 className={CARD_TITLE_CLS}>{t('模型与归属机')}</h3>
                  <p className={CARD_DESC_CLS}>
                    {boundAgent != null && boundModelId !== null
                      ? t('跟随绑定 Agent：模型 {model} · 归属机 {machine}', {
                          model: boundModelId,
                          machine: boundMachineName ?? t('未设归属机'),
                        })
                      : t('跟随绑定 Agent 的自身配置，在 Agent 的设置里调整。')}
                  </p>
                </div>
              </div>
            </>
          )}

          {tab === 'charter' && (
            <>
              {charter !== '' ? (
                // live 既有章程呈现位(r5 未拍非空章程 tab,[设计]:同空态块
                // 语言换实文)。旧 .chief-charter-text 等值迁移。
                <div className="mt-[17px] rounded-xl bg-(--secondary) px-4 py-3 text-[13px] leading-5 whitespace-pre-wrap text-(--foreground)">
                  {charter}
                </div>
              ) : (
                /* 空态虚线框 = registry Empty 件词汇（rounded-xl +
                   border-dashed，#1054 清点接依据）。 */
                <div className="mt-[17px] grid min-h-[78px] place-items-center rounded-xl border border-dashed border-(--input) bg-(--secondary) text-[13px] text-(--text-tertiary)">
                  {t('尚无章程。点击编辑，为总管添加常设指示。')}
                </div>
              )}
              <div className="mt-5 flex justify-end">
                {/* XMON-23→#950：旧 .chief-edit-btn 三点 per-face 偏差（描边
                  token、surface 底、primary 字）正是 outline 档配方——收编
                  variant="outline"（spec/22 §5.4 chief-dlg-ghost 同律，件
                  几何正典承接、差额 D2 吸收）；sm 档 28 高沿旧；px-3/
                  text-[13px] 补齐 compact 档的 12 内边距/13 字。 */}
                <Button
                  variant="outline"
                  size="sm"
                  className="px-3 text-[13px]"
                  onClick={() => setCharterOpen(true)}
                >
                  {t('编辑')}
                </Button>
              </div>
            </>
          )}

          {tab === 'memory' &&
            (live && boundAgent != null ? (
              memoriesQ.data != null ? (
                <div>
                  {/* 配额头与 agent-detail 同文（`记忆 · n / 100`，上限取 shared
                    单源常量）；行只读，管理落 Agent 详情记忆 tab。 */}
                  <p className="mt-[17px] text-xs text-(--text-tertiary)">
                    {t('记忆 · {n} / {max}', { n: memories.length, max: MEMORY_QUOTA_PER_AGENT })}
                  </p>
                  {memories.length === 0 ? (
                    <p className={EMPTY_CARD_CLS}>{t(MEMORY_EMPTY_COPY)}</p>
                  ) : (
                    <div className={`${LIST_CARD_CLS} px-4 py-1`}>
                      {memories.map((memory, index) => (
                        <div
                          key={memory.id}
                          className={
                            // XMON-117 一卡多行律：行间分隔线（旧
                            // .chief-memory-row + 兄弟选择器等值，随改落
                            // 条件类）。
                            index > 0 ? 'block border-t border-(--border) py-2' : 'block py-2'
                          }
                        >
                          <span className="block text-(--foreground)">{memory.title}</span>
                          <span className="block text-(--text-secondary)">{memory.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null
            ) : (
              <div className={EMPTY_CARD_CLS}>
                {t('尚未选择 Agent。请先在「Agent」页选定 Agent，记忆将保存在该 Agent 上。')}
              </div>
            ))}

          {tab === 'watches' &&
            (live && (watches.length > 0 || wakes.length > 0) ? (
              <div className="flex flex-col">
                {watches.map((watch) => (
                  <div key={watch.threadId} className={`${LIST_CARD_CLS} px-4 py-2`}>
                    <span className="block text-(--foreground)">{watch.title}</span>
                    <span className="block text-xs text-(--text-tertiary)">
                      {watch.threadTitle}
                    </span>
                  </div>
                ))}
                {wakes.map((wake) => {
                  const note = typeof wake.note === 'string' ? wake.note : null;
                  const at = typeof wake.at === 'number' ? wake.at : null;
                  const id = typeof wake.id === 'string' ? wake.id : null;
                  return (
                    <div key={id ?? `${at}`} className={`${LIST_CARD_CLS} px-4 py-2`}>
                      <span className="block text-(--foreground)">{note ?? t('到点提醒')}</span>
                      {at != null && (
                        <span className="block text-xs text-(--text-tertiary)">
                          {new Date(at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={EMPTY_CARD_CLS}>
                {t('暂无跟进事项。总管关注某个任务，或约定到点回头核实时，会按主题列在这里。')}
              </div>
            ))}
        </div>
      </div>
      {/* 弹窗挂在 tab 条件块外:切换 tab 不带走开态(dialog 遮罩层级高于
          设置面)。 */}
      <ChiefAgentDialog
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        agents={agentOptions}
        boundAgentId={boundAgent?.id ?? null}
        onBind={bindAgent}
      />
      <EditCharterDialog
        open={charterOpen}
        onClose={() => setCharterOpen(false)}
        charter={charter}
        onSave={saveCharter}
      />
    </div>
  );
}

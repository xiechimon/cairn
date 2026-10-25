// 总管设置 view (issue #72, r5 101–104): the gear swaps the whole content
// area to this surface — the Paper top bar (back + serif page title, #1398)
// over the 768px reading column with the 4 tabs (Agent / 章程 / 记忆 /
// 关注与提醒), each tab one settings card (DESIGN.md 页面模式 · 设置列表).
// The tab row is real state; fixture captures take the fixture's tab.
// #182 三钮接线:agent 行 = 选择总管 Agent dialog(清单 = members 读面
// memberType:"agent" 行,r5 §1;选定 → PATCH chief agent 槽,换绑带二次
// 确认 canon);章程编辑 = DialogShell 编辑弹窗(#180 裁决;保存 → PATCH
// charter 槽)。#1260 总管降级:chief 不再持模型/机器覆盖槽——Agent tab
// 一张只读信息卡说明「模型与归属机跟随绑定 Agent」并回显其值,改动去
// Agent 设置面/机器详情页。#903(ADR 0014):派发不设槽——先规划/直接修
// 由 chief 逐次派发自行判定(run_builds withPlan + dispatchReason 回执),
// settings 无「派发方式」行。

import { MEMORY_EMPTY_COPY, MEMORY_QUOTA_PER_AGENT } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { useApiMutations, useChief, useMachines, useMembers, useMemories } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SETTINGS_HINT_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { ChiefContent, ChiefSettingsTab, MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight } from '../icons/index.js';
import { ChiefAgentDialog, type ChiefAgentOption } from './chief-agent-dialog.js';
import { ChiefSpiralFace } from './chief-spiral-face.js';
import { EditCharterDialog } from './edit-charter-dialog.js';

const TABS: { id: ChiefSettingsTab; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'charter', label: '章程' },
  { id: 'memory', label: '记忆' },
  { id: 'watches', label: '关注与提醒' },
];

/** 卡内空态行（#772 律：居中 + 随文案长高；#1398 起住进设置卡，
 *  DESIGN.md 设置列表的 raw-div 行）。 */
const EMPTY_ROW_CLS = cn(
  SETTINGS_ROW_CLS,
  'justify-center text-center text-meta text-content-tertiary',
);

/** 卡内两行条目（记忆 / 关注 / 提醒）：标题 + 一行说明。 */
const ENTRY_ROW_CLS = cn(SETTINGS_ROW_CLS, 'flex-col items-start justify-center gap-0.5 py-2');

/** 已绑定 Agent 行头像（旧 .chief-agent-row-avatar 等值：首字母 chip =
 *  24 圆盘 surface 底 + 墨线框；--img 律去 chip 底边，图即圆盘）。 */
const ROW_AVATAR_CLS =
  'grid size-6 flex-none place-items-center rounded-full border border-(--border) bg-(--card) text-meta text-(--foreground)';
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
      {/* Paper 顶栏（#1398，PageShell 同形：56 高、发丝下边、返回 + 衬线页
          标题靠左）。返回 = 回总管窗（不是路由返回，故用按钮不用 Link）。 */}
      <header
        data-testid="chief-settings-topbar"
        className="flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap"
      >
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 -ml-2 size-7 flex-none cursor-pointer text-content-tertiary"
          aria-label={t('返回')}
          onClick={onBack}
        >
          <ChevronLeft width={16} height={16} />
        </Button>
        <h1 className="min-w-0 truncate font-heading text-page font-medium text-foreground">
          {t('总管设置')}
        </h1>
      </header>
      {/* #1032：面板体自持滚动——全宽滚动层承接 overflow（滚动条贴面板
          右缘），768px 阅读栏只在里面居中、不自滚；overflow-x 保持裁切。 */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        <div data-testid="chief-settings-col" className="mx-auto w-192 pt-4 pb-6">
          <SegmentedTabs
            slide
            value={tab}
            onChange={setTab}
            options={TABS.map((item) => ({ value: item.id, label: t(item.label) }))}
          />

          {tab === 'agent' && (
            <SettingsCard className="mt-4">
              {/* 绑定行 = 整行可点（资源列表行同形）：头像 + 名字 + 右缘
                  chevron；可及名 = 绑定态文案（未设置 / Agent 名）。Button 件
                  自带四边 1px 透明边，会盖掉卡片 divide-y 的分隔线（divide
                  规则零特异度）——本行恒在信息行之前，故显式只留底边。 */}
              <Button
                variant="ghost"
                className={cn(
                  SETTINGS_ROW_CLS,
                  "h-auto w-full cursor-pointer justify-start gap-3 rounded-none border-0 border-b border-border text-left text-ui font-normal text-foreground hover:bg-transparent active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent [&_svg:first-child]:text-content-tertiary [&_svg:not([class*='size-'])]:size-auto",
                )}
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
                  <ChiefSpiralFace size={24} />
                )}
                <span>{boundAgent != null ? boundAgent.name : t('未设置')}</span>
                <ChevronRight width={14} height={14} className="ml-auto text-content-tertiary" />
              </Button>
              {/* #1260：模型与归属机是绑定 Agent 的自身配置（chief 无覆盖
                槽）——只读回显 + 指路，写位在 Agent 设置面/机器详情页。 */}
              <div className={SETTINGS_ROW_CLS} data-testid="chief-follows-agent">
                <span className="flex min-w-0 flex-col">
                  <span className="text-ui text-foreground">{t('模型与归属机')}</span>
                  <span className={SETTINGS_HINT_CLS}>
                    {boundAgent != null && boundModelId !== null
                      ? t('跟随绑定 Agent：模型 {model} · 归属机 {machine}', {
                          model: boundModelId,
                          machine: boundMachineName ?? t('未设归属机'),
                        })
                      : t('跟随绑定 Agent 的自身配置，在 Agent 的设置里调整。')}
                  </span>
                </span>
              </div>
            </SettingsCard>
          )}

          {tab === 'charter' && (
            <>
              <SettingsCard className="mt-4">
                {charter !== '' ? (
                  // live 既有章程呈现位（r5 未拍非空章程 tab，[设计]）。
                  <div className="px-4 py-3 text-ui whitespace-pre-wrap text-foreground">
                    {charter}
                  </div>
                ) : (
                  <div className={EMPTY_ROW_CLS}>
                    {t('尚无章程。点击编辑，为总管添加常设指示。')}
                  </div>
                )}
              </SettingsCard>
              <div className="mt-4 flex justify-end">
                {/* 本 tab 唯一主操作 = 墨色主按钮（32 高 8 圆角）。 */}
                <Button className={DIALOG_PRIMARY_BUTTON} onClick={() => setCharterOpen(true)}>
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
                  <p className="mt-4 text-meta text-content-tertiary">
                    {t('记忆 · {n} / {max}', { n: memories.length, max: MEMORY_QUOTA_PER_AGENT })}
                  </p>
                  <SettingsCard className="mt-2">
                    {memories.length === 0 ? (
                      <p className={EMPTY_ROW_CLS}>{t(MEMORY_EMPTY_COPY)}</p>
                    ) : (
                      memories.map((memory) => (
                        <div key={memory.id} className={ENTRY_ROW_CLS}>
                          <span className="text-ui text-foreground">{memory.title}</span>
                          <span className="text-meta text-content-secondary">{memory.content}</span>
                        </div>
                      ))
                    )}
                  </SettingsCard>
                </div>
              ) : null
            ) : (
              <SettingsCard className="mt-4">
                <div className={EMPTY_ROW_CLS}>
                  {t('尚未选择 Agent。请先在「Agent」页选定 Agent，记忆将保存在该 Agent 上。')}
                </div>
              </SettingsCard>
            ))}

          {tab === 'watches' && (
            <SettingsCard className="mt-4">
              {live && (watches.length > 0 || wakes.length > 0) ? (
                <>
                  {watches.map((watch) => (
                    <div key={watch.threadId} className={ENTRY_ROW_CLS}>
                      <span className="text-ui text-foreground">{watch.title}</span>
                      <span className={SETTINGS_HINT_CLS}>{watch.threadTitle}</span>
                    </div>
                  ))}
                  {wakes.map((wake) => {
                    const note = typeof wake.note === 'string' ? wake.note : null;
                    const at = typeof wake.at === 'number' ? wake.at : null;
                    const id = typeof wake.id === 'string' ? wake.id : null;
                    return (
                      <div key={id ?? `${at}`} className={ENTRY_ROW_CLS}>
                        <span className="text-ui text-foreground">{note ?? t('到点提醒')}</span>
                        {at != null && (
                          <span className={SETTINGS_HINT_CLS}>{new Date(at).toLocaleString()}</span>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className={EMPTY_ROW_CLS}>
                  {t('暂无跟进事项。总管关注某个任务，或约定到点回头核实时，会按主题列在这里。')}
                </div>
              )}
            </SettingsCard>
          )}
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

// Agent 详情编辑面（#485，r3 §4 实测形态）：团队页点 Agent 卡进
// `/app/resources/agents/<id>?name=<名>`，三 tab 概览 / 记忆 / 权限。
//
// 为什么详情页不骑 members 读面：团队页的 `GET members` 投影出的是展示用
// TeamAgentCard（只有 displayName/model/role），职责、provider、权限四组都
// 不在其中；编辑面要的是全记录，故直取 `GET agents/{aid}`（r3 §4 词表内，
// 与 PATCH 同路径）。
//
// 数据面纪律与仓内其它 resource 页同律：`live ? 查询真值 : fixture 记录`
// （两组形状同源 = shared AgentRecord），fixture 面无后端，提交落本地覆盖
// 记录承载「提交后回显」——live 面则是 S8 律（mutation → invalidateAll 重取）。
//
// XMON-18 裁决（2026-10-01）：概览不摆 `状态` 行——`agentStatusSchema` 只有一个
// 取值 active，摆出来零信息量（原版有这一行，本仓不复刻）；`创建于 …` 也不摆
// （不需要创建时间，DB 不加 createdAt 列）。
//
// 本面明确不做的一件（证据缺口，不发明）：
// · `创建于 …` 状态行——AgentRecord 与 DB agent 表都无 createdAt 列。
//
// 承载结构 = components/ui/Button ghost（XMON-28/B3）：本面四处散写钮
// （进行中行、记忆排序触发器与选项行、名称行内编辑）换底座。排序钮/盘的
// 几何与配色正本原住 resources.css 的 `.res-sort*`，#944 起迁
// resources/parts.tsx 的 RES_* utility 常量（本面迁 registry 形态后全量
// 退役，常量已删，#1054）；其余钮的
// 正本原住 agent-detail.css，#952 起迁本文件的 AGENT_* utility 常量（等值
// 迁移，契约面逐值不动）。底座带进来的差额在消费点就地并掉：
// `justify-start` / `gap-0`（散写形是 flex-start、无序间距）、`h-auto`（行钮
// 没有定高，底座 h-8 会把 `进行中` 行与名称钮钉成 32px）、`rounded-none`
// （`.agent-task-row` 无圆角，底座 rounded-lg 会让 hover 底色带弧）、
// `font-normal`（底座 font-medium）、`leading-[inherit]`（底座 text-sm 自带
// 20px 行高；散写形走 preflight 的 `font: inherit`，本仓正解就是 inherit）、
// `[&_svg…]:size-*`（底座 size-4 会盖过图标自己的 width/height 属性）。
//
// 删除 Agent（XMON-19/B2）：入口在概览页脚，二次确认接 DeleteConfirm 家族。
// 整个流程 2026-10-01 登录原版实测过一遍（入口 → 确认层 → 取消 → 删除 → 落点），
// 文案与落点都取自实测，产线 bundle 语料是第二源、两源一致。删除语义（记忆保留、
// 任务指派摘槽、总管摘绑定）在 server services/agents.ts 注记。原版同族还有一档
// remove_over_quota 提示（删除后仍达计划上限）——本仓没有套餐/Agent 上限模型，
// 无锚可挂，故不渲染。

import {
  AGENT_PERMISSION_COPY,
  AGENT_TOOL_COPY,
  AGENT_TOOL_SWITCHES,
  type AgentMachineFitRow,
  type AgentRecord,
  MEMORY_EMPTY_COPY,
  MEMORY_QUOTA_PER_AGENT,
  MEMORY_UI_COPY,
  type PatchAgentBody,
  THINKING_LEVELS,
} from '@pacman/shared';
import { cn } from 'cn';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  useAgent,
  useAgentMachineFit,
  useAgentTasks,
  useApiMutations,
  useCapabilities,
  useMcpServers,
  useMemories,
  useModelSources,
  useSecrets,
  useSkills,
} from '../api/hooks.js';
import { toModelOptions, toThinkingLevelDisplay } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import {
  PROFILE_HINT_CLS,
  PROFILE_ROW_AUTO_CLS,
  PROFILE_VALUE_EDITOR_CLS,
  ProfileAvatar,
  ProfileCard,
  ProfileHead,
  ProfileNameRow,
  ProfileRow,
  useEditorFocus,
} from '../components/profile-card.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { Switch } from '../components/ui/switch.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { isDeleted, markDeleted } from '../fixtures/deletions.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ArrowUpDown, ChevronDown, ChevronRight, Search, SquarePen } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PHASE_UI } from '../phase.js';
import { SECRETS_HREF } from '../resources/secrets-page.js';
import { ResourceShell } from '../resources/shell.js';
import { AgentModelSelect, AgentRuntimeSelect } from './agent-model-select.js';

/** 资源族根路径（非侧栏行——原版命令面板「前往」清单里没有 Agents 行，
 *  r2 §8.4；本面只从团队页的卡进入）。 */
export const AGENTS_HREF = '/app/resources/agents';

/* —— #980 registry 对齐：手写面配方（七通道中和 / 15px·13px 字号档 / 方角）
   退役，件默认形态赢；消费点只留布局位。类名句柄原样输出（agent-detail.spec
   的 e2e 锚，零规则）。 */

/** 名称值钮：ghost 件默认形态 + 左对齐布局位（15px 手写值墨档退役，字号
 *  随件 text-sm；hover 换墨配方退役，hover 涂底 = registry 可供性）。 */
const AGENT_NAME_CLS = 'agent-name h-auto justify-start p-0 text-left font-normal';

/** 图标编辑钮：ghost 件默认 + muted 静息墨（hover 回件默认提亮）。 */
const AGENT_ICON_EDIT_CLS = 'text-muted-foreground';

/** 名称/职责编辑器：Input/Textarea 件默认形态（手写 border/card 皮肤、15px
 *  档与 13px 墨退役。#1244：focus 环是全局 2px --focus-ring outline；
 *  field-sizing-content 自增长即件正典）。别名类 agent-name-input /
 *  agent-role-input 零引用，随 #1036 终摘——e2e 锚走两编辑器的 id。 */

/** 进行中任务行：ghost 件默认形态（hover 涂底归件）+ 整块行钮布局位
 *  （h-auto 行高由内容定）。 */
const AGENT_TASK_ROW_CLS =
  'agent-task-row h-auto w-full justify-start gap-2 px-4 py-2.5 text-left font-normal';

/** #1251 机器匹配行副文案：按成因优先级点名（离线 > runtime 闸 > 能力缺项
 *  > 快照未上报 > MCP 对账缺口 > 可跑）——「缺能力 = 给修法，离线 = 等」的
 *  分野在文案层保持（Multica reason 族语义对位）。判定本身在 server
 *  （machine-fit 端点，claim/sweep 单源），这里只翻译成因。 */
function machineFitHint(m: AgentMachineFitRow, t: TFunc): string {
  if (!m.online) return t('离线');
  if (!m.runtimeOk) return t('未开启该 Agent 所需的 runtime');
  if (m.missing !== null && m.missing.length > 0) {
    return t('缺 {missing}（在该机装齐即解锁）', { missing: m.missing.join('、') });
  }
  if (m.missing === null) return t('能力快照未上报——按可跑放行');
  if (m.mcpGaps !== null && m.mcpGaps.length > 0) {
    return t('可跑；声明的 MCP 缺 {gaps}（执行时跳过）', { gaps: m.mcpGaps.join('、') });
  }
  return t('可跑');
}

type AgentTab = 'overview' | 'memory' | 'permissions';

const TAB_LABELS: { id: AgentTab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'memory', label: '记忆' },
  { id: 'permissions', label: '权限' },
];

/** 记忆 tab 的两档序（r5 §6 只观测到 `排序` 钮本体，下拉内容未观测）。
 *  [设计] 取值同 skills-page #306 的判法：只列数据面能诚实承载的键——
 *  MemoryRecord 有 createdAt，故第二档是 `添加时间`（新 → 旧）；`默认` =
 *  到达序（server 投影序，不重排）。 */
const MEMORY_SORT_OPTIONS = ['默认', '添加时间'] as const;
type MemorySort = (typeof MEMORY_SORT_OPTIONS)[number];

// claude-code effort 没有 minimal。off 与 minimal 在该 runtime 都是不发
// effort，菜单只留 off。pi 与其它 provider 用能力读面词表（缺省
// THINKING_LEVELS，含 minimal）。序跟词表走。
const CLAUDE_CODE_THINKING_LEVELS: readonly string[] = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

function thinkingLevelsForProvider(
  provider: string | null,
  catalog: readonly string[],
): readonly string[] {
  if (provider !== 'claude-code') return catalog;
  return catalog.filter((level) => CLAUDE_CODE_THINKING_LEVELS.includes(level));
}

export function AgentDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const { search } = useLocation();
  const navigate = useNavigate();
  const fixture = resolveScenario(new URLSearchParams(search));
  const { live, teamId } = useLiveData();

  const agentQ = useAgent(teamId, agentId, live);
  const agentTasksQ = useAgentTasks(teamId, agentId, live);
  // #1251 机器匹配面（live 专属读面——fixture 场景无机器上报快照，缺席 =
  // 该段不渲染，fixture 面零变化）。
  const machineFitQ = useAgentMachineFit(teamId, agentId, live);
  const memoriesQ = useMemories(teamId, agentId, live);
  const modelSourcesQ = useModelSources(teamId, live);
  const capabilitiesQ = useCapabilities(live);
  const skillsQ = useSkills(teamId, live);
  const secretsQ = useSecrets(teamId, live);
  const mcpQ = useMcpServers(teamId, live);
  const mutations = useApiMutations(teamId);

  const [tab, setTab] = useState<AgentTab>('overview');
  // fixture 面没有后端：本地覆盖记录承载「提交后回显」（live 面恒空，走
  // invalidateAll 重取）。字段语义与 patchAgent body 同。
  const [localPatch, setLocalPatch] = useState<Partial<AgentRecord>>({});
  /** fixture 面的记忆删除：没有 DELETE 后端，落本地已删集（live 面恒空）。 */
  const [removedMemories, setRemovedMemories] = useState<string[]>([]);
  /** 记忆 tab 的搜索词与排序档（#499）；排序壳与 skills-page 同源（#854 起
   *  同为 components/ui/dropdown-menu，wrap 只承布局）。 */
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memorySort, setMemorySort] = useState<MemorySort>('默认');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fixtureAgent = fixture.agents?.find((row) => row.id === agentId);
  const source = live ? agentQ.data : fixtureAgent;
  // fixture 面的删除覆面（#66 deletions）：删掉的 Agent 在本 SPA 会话里不再
  // 解析出记录，页面落既有「找不到该 Agent」态；reload 还原。
  const agent: AgentRecord | undefined =
    source === undefined || (agentId !== undefined && isDeleted(agentId))
      ? undefined
      : { ...source, ...localPatch };

  const patch = useCallback(
    (body: PatchAgentBody) => {
      if (agentId === undefined) return;
      if (live) {
        // #638 概览半（票面裁决）：名称/职责/模型/默认 skill 失败 → toast；
        // tools/secrets/skillsAllowlist/mcpServers 四组失败归权限 tab 的
        // scoped 红字行（permSaveFailed，XMON-80/P2 canon；#1169 授权技能
        // 入组）——不双报。判据 = 本次 body 的键集，与 permSaveFailed 的
        // 渲染位判据同源（那里读失败那次的 variables，这里调用点手上有
        // body）。
        mutations.patchAgent.mutate(
          { id: agentId, body },
          {
            onError: (error) => {
              if (
                'tools' in body ||
                'secrets' in body ||
                'skillsAllowlist' in body ||
                'mcpServers' in body
              )
                return;
              toastError(t('保存失败，请重试。'), error);
            },
          },
        );
      } else {
        setLocalPatch((prev) => ({ ...prev, ...body }));
      }
    },
    [agentId, live, mutations.patchAgent, t],
  );

  // 模型候选：live = model-sources 真值（#770 起 providers 段已除，只剩非
  // pi runtime 段）；fixture = 场景行集。投影单源 = toModelOptions（与总管
  // 压缩模型选择器同一份）。存量 provider 绑定值命中不了选项，走裸串兜底
  // 回显（不空白不崩）；切到 runtime 源是单向门（UI 上选不回 provider）。
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);

  // 技能候选：live 的 SkillRecord.id 与 fixture SkillRow.name 同值域
  // （skillRecordSchema：id = frontmatter name 回落目录名）。
  const skillOptions = live
    ? (skillsQ.data ?? []).map((row) => ({ id: row.id, name: row.name }))
    : (fixture.resources?.skills ?? []).map((row) => ({ id: row.name, name: row.name }));

  const memories = (live ? (memoriesQ.data ?? []) : (fixture.resources?.memories ?? [])).filter(
    (row) => row.agentId === agentId && !removedMemories.includes(row.id),
  );

  // 「进行中」段（概览）。语义 = 该 Agent 名下正在跑的 build，不是「指派给
  // 它的 todo」——判据在服务端（routes.ts 同名端点），本面只渲染。行形状 =
  // shared AgentTask，逐字段的原件出处见 agent.ts 的 schema 注释。
  const agentTasks = live ? (agentTasksQ.data ?? []) : (fixture.agentTasks ?? []);
  // live 面首帧 data 未到 ≠ 没有在跑的任务：不给空态闪一下。
  const agentTasksPending = live && agentTasksQ.isPending;

  // 搜索扫 title 与 content 两栏（r5 §6 的条目卡就是这两栏文本），ASCII 走
  // 大小写不敏感；排序只在命中集内重排，不重置搜索条件。
  const memoryNeedle = memoryQuery.trim().toLowerCase();
  const matchedMemories =
    memoryNeedle === ''
      ? memories
      : memories.filter((row) =>
          `${row.title}\n${row.content}`.toLowerCase().includes(memoryNeedle),
        );
  const visibleMemories =
    memorySort === '添加时间'
      ? [...matchedMemories].sort((a, b) => b.createdAt - a.createdAt)
      : matchedMemories;
  // 密钥只取 id 集：授权粒度是全有全无（#510），本面不逐条渲染密钥名。
  const secretIds = live
    ? (secretsQ.data ?? []).map((row) => row.id)
    : (fixture.resources?.secrets ?? []).map((row) => row.id);
  const mcpOptions = live
    ? (mcpQ.data ?? []).map((row) => ({ id: row.id, name: row.label }))
    : (fixture.resources?.mcpServers ?? []).map((row) => ({ id: row.name, name: row.name }));

  // 权限 tab 保存失败的可见反馈（XMON-80/P2）。patchAgent 是全页共用的一条
  // mutation——概览的名称 / 职责 / 模型 / 默认 skill 也走它，所以裸看 isError
  // 会把概览的失败挂在权限 tab 的红字上，指到一个用户没动过的控件。判据取
  // 失败那一次的 variables（todo-detail-page 的 restart 分支同律）：只有失败
  // 体碰了工具 / 密钥 / 授权技能 / MCP 四组，才落在这块面的账上。
  const failedPatchBody = mutations.patchAgent.variables?.body;
  const permSaveFailed =
    mutations.patchAgent.isError &&
    failedPatchBody !== undefined &&
    ('tools' in failedPatchBody ||
      'secrets' in failedPatchBody ||
      'skillsAllowlist' in failedPatchBody ||
      'mcpServers' in failedPatchBody);

  if (agent === undefined) {
    return (
      <ResourceShell
        title={t('Agent')}
        href={AGENTS_HREF}
        backHref="/app/team"
        hideNew
        fixture={fixture}
      >
        <div className="agent-detail flex flex-col gap-4">
          <p className="agent-missing text-sm text-muted-foreground">
            {t('找不到该 Agent。它可能已被删除。')}
          </p>
        </div>
      </ResourceShell>
    );
  }

  const toggleTool = (label: string, on: boolean) => {
    const next = on
      ? [...agent.tools, label].filter((v, i, all) => all.indexOf(v) === i)
      : agent.tools.filter((v) => v !== label);
    patch({ tools: next });
  };
  const toggleMcp = (id: string, on: boolean) => {
    const next = on ? [...agent.mcpServers, id] : agent.mcpServers.filter((v) => v !== id);
    patch({ mcpServers: next });
  };
  // #1251 能力要求（requiredCapabilities.mcpServers 维）：与上方 MCP 授权
  // 勾选同形不同账——授权 = 执行时可用哪些（缺装跳过降级，不挡派发）；
  // 要求 = 派发硬闸（机器快照缺项 = 不领该 Agent 的步）。两维皆空时清回
  // null（显式「无要求」，与存量行同值——不留空对象壳）。
  const toggleRequiredMcp = (id: string, on: boolean) => {
    const current = agent.requiredCapabilities ?? {};
    const nextMcp = on
      ? [...(current.mcpServers ?? []), id]
      : (current.mcpServers ?? []).filter((v) => v !== id);
    const hasModels = (current.models ?? []).length > 0;
    patch({
      requiredCapabilities:
        nextMcp.length === 0 && !hasModels ? null : { ...current, mcpServers: nextMcp },
    });
  };
  // #1169 授权技能：限制态（数组）下的逐技能勾选。两态互转入口 = 上方
  // 「不限制」开关（null ↔ []）；勾集只在限制态渲染（不限制态逐技能开关
  // 无语义——全量已可读）。显式序列化：关「不限制」发 {skillsAllowlist: []}，
  // 重开发 {skillsAllowlist: null}——undefined（不带键）= 不动，两态不得
  // 在序列化面塌缩。
  const toggleAllowlistSkill = (id: string, on: boolean) => {
    if (agent.skillsAllowlist === null) return; // 不限制态无逐技能勾选
    const next = on
      ? [...new Set([...agent.skillsAllowlist, id])]
      : agent.skillsAllowlist.filter((v) => v !== id);
    patch({ skillsAllowlist: next });
  };

  // #1169 拆字段：defaultSkill（携带，单值）直绑 wire 槽——清空 = null，
  // 不再经数组位（旧 skills:[next] 的单值伪装已退役）。
  const defaultSkill = agent.defaultSkill;
  // 运行时档的存值形：wire 的 provider 位里 'pi' 字面值与 null 同义（都 = 内置），
  // 归一成 null 再进一级选择器（选择器的清空行即「内置 (pi)」）。
  const runtimeValue = agent.provider === 'pi' ? null : agent.provider;
  // 思考强度档位跟当前 runtime。词表来自能力读面；fixture 与读面未到时用
  // THINKING_LEVELS。不在该 runtime 词表里的存值呈现为未设置。
  const thinkingCatalog = capabilitiesQ.data?.thinkingLevels ?? THINKING_LEVELS;
  const thinkingOptions = thinkingLevelsForProvider(runtimeValue, thinkingCatalog);
  const thinkingLevel = toThinkingLevelDisplay(agent.thinkingLevel, thinkingOptions);

  return (
    <ResourceShell
      title={agent.displayName}
      href={AGENTS_HREF}
      backHref="/app/team"
      hideNew
      fixture={fixture}
    >
      <div className="agent-detail flex flex-col gap-4">
        {/* tabs = registry Tabs default 档原形（手写 SEG_* 发丝环皮肤退役，
            #982 tabs 判决）；agent-tabs/agent-tab 别名留存（e2e 句柄），
            选中载体 = data-active/aria-selected。 */}
        <Tabs value={tab} onValueChange={(value) => setTab(value as AgentTab)}>
          <TabsList className="agent-tabs" aria-label={t('Agent')}>
            {TAB_LABELS.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="agent-tab px-3">
                {t(item.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {tab === 'overview' && (
          <div className="agent-overview flex flex-col gap-3.5">
            {/* XMON-117：概览按 `/app/account` 的个人页模板复刻——原来是一列
                各自带 label 的散块，现在是**一张** profile 卡：居中头像头 +
                行式字段（label 左、值槽右，行间 1px 分隔线）。
                字段集合与行序逐条不动，只换承载结构；副文案（默认 skill 与
                职责的说明）跟着 label 走，值槽仍只放值，免得长句把值挤到贴边。 */}
            <ProfileCard>
              <ProfileHead>
                <ProfileAvatar>
                  {/* 头像走 SeededAvatar 适配层（种子 / 静态兜底 / 失败换图三律），
                      profile-avatar 只给 64px 圆盒。#1156：SeededAvatar 的 Root
                      是定尺盒、尺寸由消费点显式给——漏传 className 会落到
                      registry 默认 size-8（32px），在 64px 盒里被裁。 */}
                  <SeededAvatar
                    className="size-16"
                    name={agent.displayName}
                    src={agent.avatarUrl}
                    fallback="/avatar-robot-1.svg"
                  />
                </ProfileAvatar>
              </ProfileHead>
              <ProfileNameRow
                value={agent.displayName}
                onCommit={(displayName) => patch({ displayName })}
                nameClassName={AGENT_NAME_CLS}
                editClassName={`agent-name-edit ${AGENT_ICON_EDIT_CLS}`}
                inputId="agent-name-input"
                labelClassName="agent-field-label"
              />
              <RoleRow
                value={agent.description}
                onCommit={(description) => patch({ description })}
              />
              <ProfileRow
                label={t('默认 skill')}
                hint={t(AGENT_PERMISSION_COPY.defaultSkill)}
                labelClassName="agent-field-label"
              >
                {/* XMON-75：这一格此前是裸 select 控件，弹的是 macOS 系统菜单——
                    与紧邻的模型选择器（自制弹层）并排就是两套弹窗。换成同一个
                    Select 壳后两格同形（#1010：壳 = registry select compound 族，
                    几何归 registry 默认）。值回显同模型面：候选里没有的值（技能
                    已被删除）出裸 id，不空白。「未设置」清空行 = null item。
                    #1169 起值直绑 defaultSkill 单值槽（清空发显式 null，不再
                    经数组位——与授权面 skillsAllowlist 互不影响）。
                    prefix 句柄类（agent-skill-select/-menu/-row）零规则，e2e 用；
                    弹层 Portal 落 body，locator 页面级取。 */}
                <Select
                  value={defaultSkill}
                  onValueChange={(next) => patch({ defaultSkill: next })}
                >
                  <SelectTrigger className="agent-skill-select">
                    <SelectValue>
                      {defaultSkill === null
                        ? t('未设置')
                        : (skillOptions.find((skill) => skill.id === defaultSkill)?.name ??
                          defaultSkill)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent aria-label={t('默认 skill')}>
                    <SelectItem value={null}>{t('未设置')}</SelectItem>
                    {skillOptions.map((skill) => (
                      <SelectItem key={skill.id} value={skill.id}>
                        {skill.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ProfileRow>
              <ProfileRow label={t('运行时')} labelClassName="agent-field-label">
                {/* 运行时档 = 模型槽两级选择器的一级（t-0024 诉求 2；#499 时期
                    裁「保持只读」的理由是「做成选择器要落 provider 槽并与模型
                    选择器耦合」——本票要的正是这个耦合：先选运行时/服务商、再
                    选它名下的模型。wire 仍无独立 runtime 字段，一级就是 provider
                    位：null/pi = 内置 (pi)，claude-code = 本机 Claude Code，其余
                    = custom provider id。换一级清二级（modelId 只在 provider 内
                    有意义）。 */}
                <AgentRuntimeSelect
                  value={runtimeValue}
                  options={modelOptions}
                  onPick={(next) => {
                    if (next === runtimeValue) return;
                    const nextLevels = thinkingLevelsForProvider(next, thinkingCatalog);
                    const illegal =
                      agent.thinkingLevel !== null && !nextLevels.includes(agent.thinkingLevel);
                    patch({
                      provider: next,
                      modelId: null,
                      ...(illegal ? { thinkingLevel: null } : {}),
                    });
                  }}
                  prefix="agent-runtime"
                />
              </ProfileRow>
              <ProfileRow label={t('模型')} labelClassName="agent-field-label">
                <AgentModelSelect
                  provider={runtimeValue}
                  modelId={agent.modelId}
                  options={modelOptions}
                  onPick={(next) => patch({ modelId: next })}
                  prefix="agent-model"
                />
              </ProfileRow>
              <ProfileRow label={t('思考强度')} labelClassName="agent-field-label">
                <Select
                  value={thinkingLevel}
                  onValueChange={(next) => patch({ thinkingLevel: next })}
                >
                  <SelectTrigger className="agent-thinking-select">
                    <SelectValue>
                      {thinkingLevel === null ? t('未设置') : thinkingLevel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent aria-label={t('思考强度')}>
                    <SelectItem value={null}>{t('未设置')}</SelectItem>
                    {thinkingOptions.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ProfileRow>
            </ProfileCard>
            {/* 进行中（原版概览最后一段；r3 53 截图拍到的是空态
                `暂无进行中的任务`）。卡盒 = registry Card（手写 10px 圆角
                描边 secondary 卡退役）；段头带计数，但 N=0 时不出「 · 0」
                （原件 `count > 0 ? ' · N' : ''`）。行 = `#序号` + 标题
                （单行截断）+ 状态 chip + 右箭头，整行是按钮，落点 = 任务
                详情（原件 TaskRow onPress 走 todo.id）。行间不画分隔线——
                原件 Agent 详情这一处没传 `divided`（机器详情的同款列表才
                传），照抄。chip = StatusChip 适配层 default 档（sm 几何档
                退役，#983 判决：收敛 registry h-5）。 */}
            <Card size="sm" className="agent-tasks gap-0 py-1.5">
              <p className="agent-tasks-head m-0 px-4 pb-0.5 pt-1 text-xs font-medium leading-4 text-muted-foreground">
                {t('进行中')}
                {agentTasks.length > 0 ? ` · ${agentTasks.length}` : ''}
              </p>
              {agentTasksPending ? null : agentTasks.length === 0 ? (
                <p className="agent-tasks-empty m-0 px-4 py-1.5 text-xs leading-4 text-muted-foreground">
                  {t('暂无进行中的任务')}
                </p>
              ) : (
                agentTasks.map((row) => {
                  // `state === 'waiting'`（build 已建、尚无机器领取）落
                  // PhasePill 时映射为 `queued`；其余按 todo.phase（原件逐字，
                  // 见 shared AgentTask 注释）。
                  const ui = PHASE_UI[row.state === 'waiting' ? 'queued' : row.todo.phase];
                  return (
                    <Button
                      key={row.buildId}
                      variant="ghost"
                      className={AGENT_TASK_ROW_CLS}
                      onClick={() => navigate(`/app/todo/${row.todo.id}`)}
                    >
                      <span className="agent-task-seq flex-none text-xs text-muted-foreground">
                        #{row.todo.seqNum}
                      </span>
                      <span className="agent-task-title min-w-0 flex-[1_1_auto] truncate text-sm text-foreground">
                        {row.todo.title}
                      </span>
                      {/* #983 判决：sm 几何档退役，收敛 registry Badge h-5。 */}
                      <StatusChip tone={ui.tone}>{t(ui.chip)}</StatusChip>
                      <span
                        className="agent-task-go inline-flex flex-none text-muted-foreground"
                        aria-hidden="true"
                      >
                        <ChevronRight width={12} height={12} />
                      </span>
                    </Button>
                  );
                })
              )}
            </Card>
            {/* 删除入口（r3 §4：概览页脚「删除 Agent」，在状态行之下）。按
                钮文案 = 原版语料 agent_modal.remove 原文。 */}
            <div className="agent-danger mt-1.5 flex">
              <Button
                variant="destructive"
                size="sm"
                className="agent-delete"
                onClick={() => setDeleteOpen(true)}
              >
                {t('删除 Agent')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'memory' && (
          <div className="agent-memories flex flex-col gap-2">
            {/* 配额头（r5 §6 原文 `记忆 · 1 / 100`）。n = 存量条数——配额记的
                是 Agent 上存了多少，不随搜索收窄；上限取 shared 单源常量，
                不在这写死 100（server 的超限 409 走同一个常量）。 */}
            <p className="agent-memory-head m-0 text-xs text-muted-foreground">
              {t('记忆 · {n} / {max}', {
                n: memories.length,
                max: MEMORY_QUOTA_PER_AGENT,
              })}
            </p>
            {memories.length === 0 ? (
              /* 空态文案 = shared MEMORY_EMPTY_COPY（02 §4.4/r5 §6 canon，总管
                 设置记忆 tab 同文），经 t() 消费、不作字面量出现。空列表不摆
                 搜索/排序控件（skills-page 先例：空态顶掉工具行）。 */
              <p className="agent-memory-empty m-0 text-sm text-muted-foreground">
                {t(MEMORY_EMPTY_COPY)}
              </p>
            ) : (
              <>
                {/* 搜索框 + 排序钮行：registry 形态（搜索 = InputGroup 件，
                    排序 trigger = outline 件、盘面 = DropdownMenu 件默认
                    皮肤；RES_* 手写配方已退役，常量随 #1054 清点删除）。
                    spec 命中的 agent-memory-* 类名是本域句柄（零规则，
                    #1036 闸 selector-exempt 台账钉住），零引用别名已终摘。 */}
                <div className="agent-memory-search flex flex-none items-center justify-between gap-2">
                  <InputGroup className="flex-1">
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="text"
                      placeholder={t(MEMORY_UI_COPY.searchPlaceholder)}
                      aria-label={t(MEMORY_UI_COPY.searchPlaceholder)}
                      value={memoryQuery}
                      onChange={(event) => setMemoryQuery(event.target.value)}
                    />
                  </InputGroup>
                  <span className="relative flex">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="outline" className="agent-memory-sort" />}
                      >
                        <ArrowUpDown data-icon="inline-start" />
                        <span>{t(MEMORY_UI_COPY.sort)}</span>
                        <ChevronDown width={12} height={12} className="size-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        side="bottom"
                        sideOffset={8}
                        aria-label={t(MEMORY_UI_COPY.sort)}
                        className="agent-memory-sort-menu w-auto min-w-[148px]"
                      >
                        <DropdownMenuRadioGroup
                          value={memorySort}
                          onValueChange={(next) => setMemorySort(next as MemorySort)}
                        >
                          {MEMORY_SORT_OPTIONS.map((option) => (
                            <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                              <span>{t(option)}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
                {visibleMemories.length === 0 ? (
                  /* 搜不到 ≠ 没有记忆：canon 空态说的是「一条都没存过」，
                     [设计] 另起一行，不改用 MEMORY_EMPTY_COPY。 */
                  <p className="agent-memory-no-match m-0 text-sm text-muted-foreground">
                    {t('没有匹配的记忆。')}
                  </p>
                ) : (
                  /* XMON-117：记忆行落进同一张模板卡（一卡多行、行间分隔线），
                     不再一条一张描边卡。行不是 label/值对（没有左侧字段名），
                     故直接用模板的行盒类，不走 ProfileRow。 */
                  <ProfileCard>
                    {visibleMemories.map((memory) => (
                      <div
                        key={memory.id}
                        className={cn(PROFILE_ROW_AUTO_CLS, 'agent-memory-row items-start gap-3')}
                      >
                        <span className="flex flex-1 flex-col gap-0.5">
                          <span className="agent-memory-title text-sm text-foreground">
                            {memory.title}
                          </span>
                          <span className="text-xs leading-[1.5] text-muted-foreground">
                            {memory.content}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            if (agentId === undefined) return;
                            if (live)
                              mutations.deleteMemory.mutate(
                                { agentId, memoryId: memory.id },
                                {
                                  // #638：失败 = 条目还在，此前零反馈。
                                  onError: (error) =>
                                    toastError(t('删除记忆失败，请重试。'), error),
                                },
                              );
                            else setRemovedMemories((prev) => [...prev, memory.id]);
                          }}
                        >
                          {t('删除')}
                        </Button>
                      </div>
                    ))}
                  </ProfileCard>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'permissions' && (
          <div className="agent-perms flex flex-col gap-[18px]">
            {/* XMON-80/P2：保存失败的显式反馈。本面无乐观更新——开关由服务端
                值驱动，失败时控件压根没动过，所以「什么都不说」在用户侧 = 点了
                没反应（XMON-78 实测）。文案是固定句，不透传 server / statusText
                原文：500 的 body 对用户不可操作，且网络级失败的原文是英文串，
                混进中文面反而更糊（todo-detail 的被拒提示行同律）。 */}
            {permSaveFailed && (
              <p className="agent-perm-error m-0 text-xs leading-4 text-destructive" role="alert">
                {t('保存失败，请重试。')}
              </p>
            )}
            {/* XMON-117：三组各落一张模板卡（个人页那张卡的同一套行盒）——组名
                留作段头，行 = label（+ 说明副文案）左、开关右，与个人页的
                推送通知行同形。 */}
            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-sm font-medium text-foreground">{t('工具')}</h3>
              <ProfileCard>
                {AGENT_TOOL_SWITCHES.map((label) => (
                  <ProfileRow
                    key={label}
                    label={t(label)}
                    /* 六档各带说明副文案（AGENT_TOOL_COPY 单源；原文实测自
                       参考产品的权限 tab，XMON-84 恢复全六档）。 */
                    hint={t(AGENT_TOOL_COPY[label])}
                    hintClassName="agent-perm-hint"
                  >
                    <Switch
                      className="agent-tool-switch"
                      aria-label={t(label)}
                      checked={agent.tools.includes(label)}
                      onCheckedChange={(checked) => toggleTool(label, checked)}
                    />
                  </ProfileRow>
                ))}
              </ProfileCard>
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              {/* #1169 授权技能（原 agent.skills 的授权半边）。「不限制」（null
                  = 全量可读）与「限制后全不勾」（[] = 显式全拒）是两种状态，
                  由顶部开关互转；限制态逐技能勾选（MCP 段同形），默认携带面
                  （defaultSkill，概览）与本段互不影响。 */}
              <h3 className="m-0 text-sm font-medium text-foreground">{t('授权技能')}</h3>
              <p className={PROFILE_HINT_CLS}>{t(AGENT_PERMISSION_COPY.skillsAllowlist)}</p>
              <ProfileCard>
                <ProfileRow label={t('不限制')}>
                  <Switch
                    className="agent-allowlist-switch"
                    aria-label={t('不限制')}
                    checked={agent.skillsAllowlist === null}
                    onCheckedChange={(on) => patch({ skillsAllowlist: on ? null : [] })}
                  />
                </ProfileRow>
                {(() => {
                  // 局部 const 收窄进 map 闭包（agent 合并对象的属性收窄不跨
                  // 回调边界）：null 态不渲染逐技能行。
                  const allowlist = agent.skillsAllowlist;
                  if (allowlist === null) return null;
                  return skillOptions.map((skill) => (
                    <ProfileRow key={skill.id} className="agent-allowlist-row" label={skill.name}>
                      <Switch
                        className="agent-allowlist-skill-switch"
                        aria-label={skill.name}
                        checked={allowlist.includes(skill.id)}
                        onCheckedChange={(checked) => toggleAllowlistSkill(skill.id, checked)}
                      />
                    </ProfileRow>
                  ));
                })()}
              </ProfileCard>
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-sm font-medium text-foreground">{t('密钥')}</h3>
              {/* 授权粒度 = 原版的「全有全无」（#510）：一行「团队密钥 + 总
                  说明 + 单个 switch」。原版 Agent 权限 tab 不展开逐个密钥行
                  （2026-09-30 直读参考产品确认），密钥页的行菜单也只有编辑/
                  删除、没有 per-Agent 矩阵。wire 的 secrets: string[] 表达得
                  了：开 = 全 id 集，关 = 空集。勾选态 = agent.secrets 非空。
                  零密钥时不出开关——没有对象可授，出了就是死控件。 */}
              {secretIds.length === 0 ? (
                // XMON-80/P3：零密钥时不出开关（没有对象可授），但也不能把
                // 用户停在一句陈述句上——创建入口本来就在侧栏密钥页，这里给
                // 出指向它的入口。search 随行 = 仓内 Link 律（sidebar /
                // parts.tsx 同法），生产 build 里 scenario 参数本就被编译期
                // 折叠、不参与路由。
                <ProfileCard>
                  <div className={cn(PROFILE_ROW_AUTO_CLS, 'items-baseline gap-2')}>
                    <p className="agent-perm-empty m-0 text-sm text-muted-foreground">
                      {t('暂无团队密钥。')}
                    </p>
                    <Link
                      className="agent-secret-add text-xs leading-4 text-primary no-underline hover:underline"
                      to={{ pathname: SECRETS_HREF, search }}
                    >
                      {t('去添加密钥')}
                    </Link>
                  </div>
                </ProfileCard>
              ) : (
                <ProfileCard>
                  <ProfileRow
                    className="agent-secret-row"
                    label={t('团队密钥')}
                    /* canon 副文案（AGENT_PERMISSION_COPY.secrets）内嵌
                       BRAND.cliCommandName 与密钥最低 CLI 版本插值，键值随
                       品牌常量走。 */
                    hint={t(AGENT_PERMISSION_COPY.secrets)}
                    labelClassName="agent-secret-name"
                    hintClassName="agent-perm-hint agent-secret-hint"
                  >
                    <Switch
                      className="agent-secret-switch"
                      aria-label={t('团队密钥')}
                      checked={agent.secrets.length > 0}
                      onCheckedChange={(checked) => patch({ secrets: checked ? secretIds : [] })}
                    />
                  </ProfileRow>
                </ProfileCard>
              )}
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              {/* 段级说明（整组共用一句，不挂在单行上——挂哪一行都是任选），
                  形随模板的副文案档（12px 三级色）。 */}
              <h3 className="m-0 text-sm font-medium text-foreground">{t('MCP 服务器')}</h3>
              <p className={PROFILE_HINT_CLS}>{t(AGENT_PERMISSION_COPY.mcpServers)}</p>
              {mcpOptions.length === 0 ? (
                <ProfileCard>
                  <div className={cn(PROFILE_ROW_AUTO_CLS, 'items-baseline gap-2')}>
                    <p className="agent-perm-empty m-0 text-sm text-muted-foreground">
                      {t('暂无 MCP 服务器。')}
                    </p>
                  </div>
                </ProfileCard>
              ) : (
                <ProfileCard>
                  {mcpOptions.map((server) => (
                    <ProfileRow key={server.id} className="agent-mcp-row" label={server.name}>
                      <Switch
                        aria-label={server.name}
                        checked={agent.mcpServers.includes(server.id)}
                        onCheckedChange={(checked) => toggleMcp(server.id, checked)}
                      />
                    </ProfileRow>
                  ))}
                </ProfileCard>
              )}
            </section>

            <section className="agent-perm-group agent-machine-fit flex flex-col gap-2">
              {/* #1251 机器匹配（ADR 0018 决策 4.6）：执行要求写面（能力闸的
                  声明位）+「哪些机器可跑它」读面（判定单源在 server——claim/
                  sweep 同一份 dispatch-eligibility 原语，本面只呈现）。读面
                  live 专属：fixture 场景无机器上报快照，缺席 = 只渲染写面。 */}
              <h3 className="m-0 text-sm font-medium text-foreground">{t('机器匹配')}</h3>
              <p className={PROFILE_HINT_CLS}>
                {t(
                  '执行要求 = 派发硬闸：能力快照不满足的机器不领该 Agent 的步（排队面会给可见成因）；从未上报快照的机器按可跑放行。',
                )}
              </p>
              {mcpOptions.length === 0 ? (
                <ProfileCard>
                  <div className={cn(PROFILE_ROW_AUTO_CLS, 'items-baseline gap-2')}>
                    <p className="agent-perm-empty m-0 text-sm text-muted-foreground">
                      {t('暂无 MCP 服务器。')}
                    </p>
                  </div>
                </ProfileCard>
              ) : (
                <ProfileCard>
                  {mcpOptions.map((server) => (
                    <ProfileRow
                      key={server.id}
                      className="agent-required-mcp-row"
                      label={server.name}
                      hint={t('要求执行机已安装该 MCP 服务器')}
                      hintClassName="agent-perm-hint"
                    >
                      <Switch
                        className="agent-required-mcp-switch"
                        aria-label={t('要求安装 {name}', { name: server.name })}
                        checked={(agent.requiredCapabilities?.mcpServers ?? []).includes(server.id)}
                        onCheckedChange={(checked) => toggleRequiredMcp(server.id, checked)}
                      />
                    </ProfileRow>
                  ))}
                </ProfileCard>
              )}
              {live && machineFitQ.data !== undefined && (
                <ProfileCard>
                  {machineFitQ.data.machines.length === 0 ? (
                    <div className={cn(PROFILE_ROW_AUTO_CLS, 'items-baseline gap-2')}>
                      <p className="m-0 text-sm text-muted-foreground">{t('暂无机器。')}</p>
                    </div>
                  ) : (
                    machineFitQ.data.machines.map((m) => (
                      <ProfileRow
                        key={m.machineId}
                        className="agent-fit-row"
                        label={m.name}
                        hint={machineFitHint(m, t)}
                        hintClassName="agent-perm-hint"
                      >
                        <span
                          className={cn(
                            'text-xs',
                            m.canRun ? 'text-muted-foreground' : 'text-destructive',
                          )}
                        >
                          {m.canRun ? t('可跑') : t('不可跑')}
                        </span>
                      </ProfileRow>
                    ))
                  )}
                </ProfileCard>
              )}
            </section>
          </div>
        )}
      </div>
      {/* 删除确认（2026-10-01 登录原版实测，与产线 bundle 语料两源一致）：
          标题 `删除 Agent？`、正文 `将「{name}」移出团队？该 Agent 进行中的任务
          将被停止。`、两钮 `取消` / `删除`，逐字。取消路径实测：点取消 → 层关、
          留在详情页、Agent 未删。 */}
      <DeleteConfirm
        open={deleteOpen}
        title={t('删除 Agent？')}
        summary={t('将「{name}」移出团队？该 Agent 进行中的任务将被停止。', {
          name: agent.displayName,
        })}
        ariaLabel={t('删除 Agent')}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          if (agentId === undefined) return;
          // 确认后落团队页 `/app/team`，无提示条——2026-10-01 登录原版实测（不再是
          // 推断：点「删除」后地址先停在详情页，随请求落地切到 `/app/team`，页面
          // 无 toast/横幅）。search 随行 = #121 Link 律（fixture 的场景位不能在这
          // 一跳丢；原版无此查询参，观测不到差异）。
          if (live) {
            mutations.deleteAgent.mutate(agentId, {
              onSuccess: () => navigate({ pathname: '/app/team', search }),
              // #638：确认层已关，失败 = Agent 还在却零解释。
              onError: (error) => toastError(t('删除 Agent 失败，请重试。'), error),
            });
            return;
          }
          markDeleted(agentId);
          navigate({ pathname: '/app/team', search });
        }}
      />
    </ResourceShell>
  );
}

/** 职责编辑（r3 §4 原文注：「用一两句话说明该 Agent 的职责。…」）。未设置时
 *  出 canon 空态文案（团队页卡同一串）。
 *  #1243：显示态值槽可收缩折行（whitespace-pre-line 保留作者换行，trim +
 *  连续空行折叠——编辑态草稿的多余空行不进显示态）；编辑态 Textarea 不变。 */
function RoleRow({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useEditorFocus<HTMLTextAreaElement>(draft !== null);
  // #1243：显示态 trim + 连续空行折叠（3+ 个换行 → 2 个），不把编辑态草稿的
  // 多余空行带进显示态。
  const display = value == null ? null : value.trim().replace(/\n{3,}/g, '\n\n');
  // 说明副文案是这一行的常驻部分（编辑态也在）：它是「怎么写」的指导，
  // 编辑时撤掉反而最需要它的时候没了。
  return (
    <ProfileRow
      label={t('职责')}
      hint={t(AGENT_PERMISSION_COPY.responsibility)}
      labelClassName="agent-field-label"
      valueClassName={draft === null ? 'items-start' : PROFILE_VALUE_EDITOR_CLS}
    >
      {draft === null ? (
        <>
          <span className="agent-role-text min-w-0 flex-[1_1_auto] text-sm whitespace-pre-line break-words text-foreground">
            {display ?? t('未设置职责')}
          </span>
          <div className="flex justify-end gap-2">
            {/* r3 §4 实测：职责行带编辑图标（点击进编辑态）。图标-only 钮，
                可访问名走 aria-label；文字钮的可点感靠图标补。 */}
            <Button
              variant="ghost"
              size="icon-sm"
              className={`agent-role-edit ${AGENT_ICON_EDIT_CLS}`}
              aria-label={t('编辑')}
              onClick={() => setDraft(value ?? '')}
            >
              <SquarePen width={14} height={14} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <Textarea
            id="agent-role-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              className="agent-role-save"
              onClick={() => {
                const next = draft.trim();
                onCommit(next === '' ? null : next);
                setDraft(null);
              }}
            >
              {t('保存')}
            </Button>
          </div>
        </>
      )}
    </ProfileRow>
  );
}

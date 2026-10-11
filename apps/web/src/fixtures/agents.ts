import type { AgentRecord, AgentTask, MemoryRecord, SecretRecord } from '@pacman/shared';
import { boardDefault } from './board.js';
import { CHIEF_EXAMPLES } from './chief.js';
import { legacyDone, legacyReview, PROJECT_ID, R3_BUILDER, TEAM_ID } from './core.js';
import type { ChiefContent, FixtureSet, ResourcesContent, TeamContent } from './records.js';
import { RESOURCES } from './resources.js';
import { TEAM_R7, teamGrid } from './team.js';

// ── Agent 详情编辑面（r3 §4 实测样本）────────────────────────────────────
// 记录字段逐字 = r3 §4 的 wire 样本（provider `r3-gw`、modelId
// `claude-sonnet-5`、thinkingLevel null、四组权限数组全空）；团队页卡上的
// `未设置职责` 就是这里 description:null 的呈现。

/** Agent 记录样本（r3 §4 wire 原样——存量 provider 绑定：#770 起 picker 不再
 *  列 providers 段，本记录是存量值裸串回显的 pin 源）。 */
const AGENT_R3_BUILDER: AgentRecord = {
  id: R3_BUILDER.id,
  displayName: R3_BUILDER.displayName,
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

/** Agent 详情 + 创建弹窗模型位的数据集：团队页 roster 与详情页记录同场景，
 *  团队页卡点进详情后 `?scenario=agent-detail` 随行（#121 Link 律）不会丢。
 *  resources 在 RESOURCES 之上补空 memories（记忆 tab 走 shared canon 空态）。
 *  本集不带 providers（#770 起 picker 不再读 providers 段）与 secrets（密钥区
 *  走零密钥空态，#510：无密钥时不出开关，没有对象可授）；memories 的两形
 *  （空 / 非空）由下面两个导出件分持。 */
const AGENT_DETAIL_RESOURCES: ResourcesContent = {
  ...RESOURCES,
  memories: [],
};

export const agentDetail: FixtureSet = {
  ...teamGrid,
  agents: [AGENT_R3_BUILDER],
  resources: AGENT_DETAIL_RESOURCES,
};

/** #510 密钥区聚合总开关的数据集：两个团队密钥 + 一个未授权的 Agent。
 *  两个密钥是有意的——per-secret 粒度回退会渲染两行，e2e 的「恰好一行」
 *  才有牙（只播一个密钥时两种实现都过）。 */
const AGENT_DETAIL_SECRETS: SecretRecord[] = [
  { id: 'secret-stripe', teamId: TEAM_ID, name: 'STRIPE_API_KEY', description: null },
  { id: 'secret-npm', teamId: TEAM_ID, name: 'NPM_TOKEN', description: null },
];

export const agentDetailSecrets: FixtureSet = {
  ...agentDetail,
  resources: { ...AGENT_DETAIL_RESOURCES, secrets: AGENT_DETAIL_SECRETS },
};

/** #499 named scenario（无 capture，agentDetail 先例）：记忆 tab 的非空语料。
 *  r5 §6 捕获（截图 134）只有 1 条记忆（`记忆 · 1 / 100`），多行排序在那份
 *  语料里长不出来；这里给 r3-builder 合成 3 条。三处刻意安排：
 *  · 列序（旧 → 新）与标题序不同——`默认`（到达序）与 `添加时间`（新 → 旧）
 *    两档才分得开；
 *  · 只有第 2 条的 content 含 `probe`、只有第 3 条的 title 含 `PROBE`——搜索
 *    的「命中 content」与「ASCII 大小写不敏感」各钉一条；
 *  · `添加时间` 档下两档的先后正好对调。
 *  供 ./e2e/agent-detail.spec.ts 钉配额头、搜索过滤与排序。 */
const AGENT_MEMORY_ROWS: MemoryRecord[] = [
  {
    id: 'mem-r5-1',
    agentId: R3_BUILDER.id,
    teamId: TEAM_ID,
    title: '构建分支的命名规律',
    content: '构建分支固定 agent/<运行 id>，不再挂日期后缀。',
    projectId: PROJECT_ID,
    sourceTodoId: null,
    sourceBuildId: null,
    createdAt: boardDefault.now - 180 * 60_000,
    updatedAt: boardDefault.now - 180 * 60_000,
  },
  {
    id: 'mem-r5-2',
    agentId: R3_BUILDER.id,
    teamId: TEAM_ID,
    title: '验收只看真机跑通',
    content: '本地绿不算数，要在 probe 机器上真跑一遍再报完成。',
    projectId: PROJECT_ID,
    sourceTodoId: null,
    sourceBuildId: null,
    createdAt: boardDefault.now - 120 * 60_000,
    updatedAt: boardDefault.now - 120 * 60_000,
  },
  {
    id: 'mem-r5-3',
    agentId: R3_BUILDER.id,
    teamId: TEAM_ID,
    title: 'PROBE 探针的历史轮次',
    content: 'r3、r5b、r6、r7 每轮各留一个 commit 收尾。',
    projectId: PROJECT_ID,
    sourceTodoId: null,
    sourceBuildId: null,
    createdAt: boardDefault.now - 60 * 60_000,
    updatedAt: boardDefault.now - 60 * 60_000,
  },
];

export const agentDetailMemory: FixtureSet = {
  ...agentDetail,
  resources: { ...AGENT_DETAIL_RESOURCES, memories: AGENT_MEMORY_ROWS },
};

/** Agent 详情「进行中」段的非空语料（无 capture，agentDetail 先例——r3 53
 *  截图拍到的正是空态「暂无进行中的任务」，行态在观测窗口里长不出来）。
 *  两行刻意分持两个状态支：第 1 行 `state:'waiting'`（build 已建、等机器，
 *  消费面把它渲染成 `queued` 的 chip），第 2 行 `state:null`（跑起来了，
 *  chip 直接吃 todo.phase 的 `building`）。标题取自参考账号里真实存在的两条
 *  todo（seq 12 / 13），不是编的。
 *  供 ./e2e/agent-detail.spec.ts 钉行形状、状态位映射与点击落点。 */
const AGENT_TASK_ROWS: AgentTask[] = [
  {
    kind: 'build',
    state: 'waiting',
    buildId: 'r3-conv-task-12',
    todo: {
      id: 'r3-legacy-12',
      seqNum: 12,
      title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/',
      phase: 'queued',
    },
  },
  {
    kind: 'build',
    state: null,
    buildId: 'r3-conv-task-13',
    todo: {
      id: 'r3-legacy-13',
      seqNum: 13,
      title: '给 README.md 增加「项目结构」一节并链接贡献指南',
      phase: 'building',
    },
  },
];

export const agentDetailActive: FixtureSet = {
  ...agentDetail,
  agentTasks: AGENT_TASK_ROWS,
};

/** #741 named scenario（无 capture，chief-md / agentDetail 先例）：agent 身份
 *  可点进设置的两面语料。① 抽屉 robot 行身份 chip——chief.agent 带 id（live
 *  mapper 恒带，fixture 面特意给 id 才钉得住「成链」面；无 id 惰性面由单测
 *  test/chief-identity.test.ts 钉）；② 提及 chip——robot markdown 携五种
 *  scheme 的 mention wire：agent/todo 成链（#741/#675 两个导航面），
 *  skill/project/machine 保持惰性 span（参考站落点未实拍取证，票面明确不入
 *  本票——字面负例要有牙，三种同播）。detail transcript 同场景带一条 agent
 *  提及——segments 单源的两个消费面（抽屉 + 详情页对话）一套语料钉齐。
 *  agents 复用 AGENT_R3_BUILDER：身份 chip 点击后 scenario 按 #121 Link 律
 *  随行，Agent 详情页解析出真记录（fixture 面全链）。 */
const CHIEF_AGENT_CHIP_REPLY = [
  '派工回执：由 [r5-scribe](agent:a1) 复核 [#1](todo:r3-legacy-1)。',
  '',
  '技能 [deploy](skill:s1)、项目 [web](project:p1) 与机器 [box](machine:m1) 的提及保持惰性。',
].join('\n');

export const chiefAgentChip: FixtureSet = {
  ...agentDetail,
  todos: [legacyReview, legacyDone],
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '验证一下凭证链路…',
    agent: { id: R3_BUILDER.id, displayName: R3_BUILDER.displayName, avatarUrl: null },
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'user', text: '验证一下凭证链路，然后给我一份报告' },
      {
        kind: 'robot',
        markdown: CHIEF_AGENT_CHIP_REPLY,
        seconds: '44s',
      },
    ],
  },
  detail: {
    transcript: [
      { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
      { kind: 'user', text: '开始执行任务', seq: 1 },
      {
        kind: 'robot',
        markdown: '凭证复核由 [r5-scribe](agent:a1) 承接，完成后汇报。',
        footer: { seconds: 12 },
      },
    ],
  },
};

/** XMON-19/B2 删除 Agent 的 e2e 语料（命名场景无 capture，agent-detail
 *  先例）：roster 两个 Agent——删掉 r3-builder 后名单里还剩一个，卡随行消失
 *  这一条才有牙（只播一个 Agent 时「删对了」与「整块空掉」两种实现都过）。
 *  邻居字段形状照 todos.dev 实测 members 行。 */
const AGENT_DELETE_NEIGHBOR: TeamContent['agents'][number] = {
  id: 'r3-qa',
  displayName: 'r3-qa',
  model: 'claude-sonnet-5',
  isDefault: false,
  role: '负责回归测试与验收。',
};

export const agentDelete: FixtureSet = {
  ...agentDetail,
  team: { members: 2, agents: [...TEAM_R7.agents, AGENT_DELETE_NEIGHBOR] },
};

/** #444 named scenario（无 capture，notify-banner 先例）：绑定 Agent 的
 *  头像骑上总管 FAB。一套内容同时供 board（.chief-fab）与 team（secondary
 *  壳的 总管 FAB，#947 起载体 = aria-label）两个消费点（projectFixture
 *  多路由单集先例）；
 *  chiefUnread 2 钉角标与头像共存面。avatarUrl null = dicebear 按
 *  displayName 种子生成，e2e 钉图标来源切换（chief-fab.spec），非像素。 */
const FAB_AVATAR_CHIEF: ChiefContent = {
  // ADR 0013 D4：FAB 与窗互斥——FAB 面的捕获形 = 关窗态（view: 'none'；
  // 旧形抽屉开态仍挂 FAB，互斥退役该共存面）；#444 钉面是 FAB 头像，不是窗。
  view: 'none',
  bound: true,
  modelSlot: 'claude-sonnet-5 · 默认',
  threadTitle: '新主题',
  examples: CHIEF_EXAMPLES,
  agent: { displayName: R3_BUILDER.displayName, avatarUrl: null },
};

export const chiefFabAvatar: FixtureSet = {
  ...teamGrid,
  chiefUnread: 2,
  chief: FAB_AVATAR_CHIEF,
};

/** 同面的 avatarUrl 覆盖变体：覆盖值赢过 dicebear 生成（Avatar 原语语义
 *  在 FAB 层的透传钉）；资产用本地 /avatar-robot-2.svg，零网络。 */
export const chiefFabAvatarOverride: FixtureSet = {
  ...teamGrid,
  chiefUnread: 2,
  chief: {
    ...FAB_AVATAR_CHIEF,
    agent: { displayName: R3_BUILDER.displayName, avatarUrl: '/avatar-robot-2.svg' },
  },
};

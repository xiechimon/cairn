import type { AgentRecord, AgentTask, MemoryRecord, SecretRecord } from '@cairn/shared';
import { boardDefault } from './board.js';
import { CHIEF_EXAMPLES } from './chief.js';
import { legacyDone, legacyReview, PROJECT_ID, R3_BUILDER, TEAM_ID } from './core.js';
import type { ChiefContent, FixtureSet, ResourcesContent, TeamContent } from './records.js';
import { RESOURCES } from './resources.js';
import { TEAM_R7, teamGrid } from './team.js';

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

const AGENT_DETAIL_RESOURCES: ResourcesContent = {
  ...RESOURCES,
  memories: [],
};

export const agentDetail: FixtureSet = {
  ...teamGrid,
  agents: [AGENT_R3_BUILDER],
  resources: AGENT_DETAIL_RESOURCES,
};

const AGENT_DETAIL_SECRETS: SecretRecord[] = [
  { id: 'secret-stripe', teamId: TEAM_ID, name: 'STRIPE_API_KEY', description: null },
  { id: 'secret-npm', teamId: TEAM_ID, name: 'NPM_TOKEN', description: null },
];

export const agentDetailSecrets: FixtureSet = {
  ...agentDetail,
  resources: { ...AGENT_DETAIL_RESOURCES, secrets: AGENT_DETAIL_SECRETS },
};

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

const FAB_AVATAR_CHIEF: ChiefContent = {
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

export const chiefFabAvatarOverride: FixtureSet = {
  ...teamGrid,
  chiefUnread: 2,
  chief: {
    ...FAB_AVATAR_CHIEF,
    agent: { displayName: R3_BUILDER.displayName, avatarUrl: '/avatar-robot-2.svg' },
  },
};

export const AGENT_LONG_ROLE = [
  '负责该 Agent 名下的全部代码实现与工程修改。',
  '任务开工前先读取仓库既有规范与构建脚本，确认改动边界；实现阶段以最小可验证改动为单位逐步落盘，每个改动点都给出可复现的验证命令与预期结果；收尾阶段跑通受影响面的 typecheck 与 lint，把失败场景的实测输出留在提交信息里。',
  '遇到跨模块的接口改动，先列出所有消费面再做缝纪律校验，不在没有完整阅读过的文件里凭搜索片段做广义修改。',
  '',
  '',
  '',
  '对外部依赖的 API 形状一律以 node_modules 里的类型声明与真源为准，不凭记忆推断；版本以 pnpm ls 钉死。',
  '删除任何看似有意的功能前先向负责人确认，避免把历史决策当废码。',
].join('\n');

const AGENT_LONG_ROLE_CARD: TeamContent['agents'][number] = {
  id: R3_BUILDER.id,
  displayName: R3_BUILDER.displayName,
  model: 'claude-sonnet-5',
  isDefault: true,
  role: AGENT_LONG_ROLE,
};

export const agentLongRoleTeam: FixtureSet = {
  ...agentDetail,
  team: { members: 1, agents: [AGENT_LONG_ROLE_CARD] },
};

export const agentLongRole: FixtureSet = {
  ...agentDetail,
  agents: [{ ...AGENT_R3_BUILDER, description: AGENT_LONG_ROLE }],
  team: { members: 1, agents: [AGENT_LONG_ROLE_CARD] },
};

export const AGENT_LONG_MODEL_IDS = [
  'claude-opus-4-5',
  'deepseek-v4-pro[1M]',
  'qwen3.8-max-0902[1M]',
  'vendor/very-long-model-id-for-clipping-check-2026-10[1M]',
];

export const agentDetailLongModels: FixtureSet = {
  ...agentDetail,
  agents: [{ ...AGENT_R3_BUILDER, provider: 'claude-code', modelId: 'qwen3.8-max-0902[1M]' }],
  resources: {
    ...AGENT_DETAIL_RESOURCES,
    providerSources: AGENT_DETAIL_RESOURCES.providerSources.map((source) =>
      source.runtime === 'claude-code'
        ? { ...source, models: AGENT_LONG_MODEL_IDS.map((id) => ({ id, name: id })) }
        : source,
    ),
  },
};

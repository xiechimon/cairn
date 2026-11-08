import type { SecretRecord } from '@cairn/shared';
import { legacyDone, legacyReview, R3_BUILDER, TEAM_ID } from './core.js';
import type { ChiefContent, FixtureSet, ResourcesContent } from './records.js';
import { RESOURCES } from './resources.js';
import { teamGrid } from './team.js';

const SECRETS_BASE: ResourcesContent = {
  ...RESOURCES,
  memories: [],
};

const SECRET_ROWS: SecretRecord[] = [
  {
    id: 'secret-stripe',
    teamId: TEAM_ID,
    projectId: null,
    name: 'STRIPE_API_KEY',
    description: null,
  },
  { id: 'secret-npm', teamId: TEAM_ID, projectId: null, name: 'NPM_TOKEN', description: null },
];

export const secretsList: FixtureSet = {
  ...teamGrid,
  resources: { ...SECRETS_BASE, secrets: SECRET_ROWS },
};

const CHIEF_AGENT_CHIP_REPLY = [
  '派工回执：由 [r5-scribe](agent:a1) 复核 [#1](todo:r3-legacy-1)。',
  '',
  '技能 [deploy](skill:s1)、项目 [web](project:p1) 与机器 [box](machine:m1) 的提及保持惰性。',
].join('\n');

export const chiefAgentChip: FixtureSet = {
  ...teamGrid,
  resources: SECRETS_BASE,
  todos: [legacyReview, legacyDone],
  chief: {
    view: 'none',
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

const FAB_AVATAR_CHIEF: ChiefContent = {
  view: 'none',
  bound: true,
  modelSlot: 'claude-sonnet-5 · 默认',
  threadTitle: '新主题',
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

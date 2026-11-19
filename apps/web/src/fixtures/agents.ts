import type { BrowserPasswordGrant, SecretListEntry } from '@cairn/shared';
import {
  legacyDone,
  legacyReview,
  MACHINE_ID,
  MACHINE_NAME,
  MACHINE_REMOTE_ID,
  MACHINE_REMOTE_NAME,
  R3_BUILDER,
  TEAM_ID,
} from './core.js';
import type { ChiefContent, FixtureSet, ResourcesContent } from './records.js';
import { RESOURCES } from './resources.js';
import { teamGrid } from './team.js';

const SECRETS_BASE: ResourcesContent = {
  ...RESOURCES,
  memories: [],
};

const SECRET_NOW = Date.now();
const MINUTE_MS = 60_000;

const SECRET_ROWS: SecretListEntry[] = [
  {
    id: 'secret-stripe',
    teamId: TEAM_ID,
    projectId: null,
    name: 'STRIPE_API_KEY',
    description: null,
    kind: 'secret',
    updatedAt: SECRET_NOW - 3 * 24 * 60 * MINUTE_MS,
  },
  {
    id: 'secret-node-env',
    teamId: TEAM_ID,
    projectId: null,
    name: 'NODE_ENV',
    description: null,
    kind: 'env',
    value: 'development',
    updatedAt: SECRET_NOW - 12 * MINUTE_MS,
  },
  {
    id: 'secret-api-base',
    teamId: TEAM_ID,
    projectId: null,
    name: 'PUBLIC_API_BASE_URL',
    description: null,
    kind: 'env',
    value: 'https://api.staging.example.com/v2/internal/gateway?region=ap-southeast-1',
    updatedAt: SECRET_NOW - 5 * 60 * MINUTE_MS,
  },
  {
    id: 'secret-debug',
    teamId: TEAM_ID,
    projectId: null,
    name: 'DEBUG',
    description: null,
    kind: 'env',
    value: '',
    updatedAt: SECRET_NOW - 26 * 60 * MINUTE_MS,
  },
  { id: 'secret-npm', teamId: TEAM_ID, projectId: null, name: 'NPM_TOKEN', description: null },
];

const VAULT_SECRET_ROWS: SecretListEntry[] = [
  {
    id: 'secret-gh-login',
    teamId: TEAM_ID,
    projectId: null,
    name: 'GITHUB_COM',
    description: 'github.com',
    kind: 'pair',
    updatedAt: SECRET_NOW - 2 * 24 * 60 * MINUTE_MS,
  },
  {
    id: 'secret-notion-login',
    teamId: TEAM_ID,
    projectId: null,
    name: 'NOTION_SO',
    description: 'notion.so',
    kind: 'pair',
    updatedAt: SECRET_NOW - 26 * 60 * MINUTE_MS,
  },
  {
    id: 'secret-vps-login',
    teamId: TEAM_ID,
    projectId: null,
    name: 'LOGIN_VPS_EXAMPLE_COM',
    description: 'vps.example.com',
    kind: 'pair',
    updatedAt: SECRET_NOW - 9 * 24 * 60 * MINUTE_MS,
  },
  {
    id: 'secret-gh-token',
    teamId: TEAM_ID,
    projectId: null,
    name: 'GH_TOKEN',
    description: null,
    kind: 'secret',
    updatedAt: SECRET_NOW - 30 * 24 * 60 * MINUTE_MS,
  },
];

const VAULT_GRANTS: BrowserPasswordGrant[] = [
  {
    grantId: 'grant-gh-active',
    secretId: 'secret-gh-login',
    secretName: 'GITHUB_COM',
    origin: 'https://github.com',
    machineId: MACHINE_ID,
    machineName: MACHINE_NAME,
    state: 'active',
    createdAt: SECRET_NOW - 3 * 60 * MINUTE_MS,
    grantedAt: SECRET_NOW - 3 * 60 * MINUTE_MS,
    revokedAt: null,
  },
  {
    grantId: 'grant-notion-stale',
    secretId: 'secret-notion-login',
    secretName: 'NOTION_SO',
    origin: 'https://www.notion.so',
    machineId: MACHINE_REMOTE_ID,
    machineName: MACHINE_REMOTE_NAME,
    state: 'stale',
    createdAt: SECRET_NOW - 5 * 24 * 60 * MINUTE_MS,
    grantedAt: SECRET_NOW - 5 * 24 * 60 * MINUTE_MS,
    revokedAt: null,
  },
  {
    grantId: 'grant-gitlab-revoked',
    secretId: 'secret-gh-token',
    secretName: 'GH_TOKEN',
    origin: 'https://gitlab.com',
    machineId: MACHINE_ID,
    machineName: MACHINE_NAME,
    state: 'revoked',
    createdAt: SECRET_NOW - 8 * 24 * 60 * MINUTE_MS,
    grantedAt: SECRET_NOW - 8 * 24 * 60 * MINUTE_MS,
    revokedAt: SECRET_NOW - 26 * 60 * MINUTE_MS,
  },
];

export const vaultList: FixtureSet = {
  ...teamGrid,
  resources: {
    ...SECRETS_BASE,
    secrets: VAULT_SECRET_ROWS,
    browserPasswordGrants: VAULT_GRANTS,
  },
};

export const vaultEmpty: FixtureSet = {
  ...teamGrid,
  resources: {
    ...SECRETS_BASE,
    secrets: [],
    browserPasswordGrants: [],
  },
};

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

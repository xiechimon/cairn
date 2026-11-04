import { boardDefault } from './board.js';
import { MACHINE_ID, MACHINE_REMOTE_ID, R3_BUILDER } from './core.js';
import type { FixtureSet, TeamContent } from './records.js';
import { RESOURCES } from './resources.js';

export const TEAM_R7: TeamContent = {
  members: 1,
  agents: [
    {
      id: R3_BUILDER.id,
      displayName: R3_BUILDER.displayName,
      model: 'claude-sonnet-5',
      isDefault: true,
      role: null,
    },
  ],
};

export const teamGrid: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_R7,
};

const TEAM_ORG_CHART: TeamContent = {
  members: 3,
  agents: [
    {
      id: 'org-chief',
      displayName: 'r3-builder',
      model: 'claude-sonnet-5',
      isDefault: true,
      role: '负责代码实现与工程修改。',
      provider: 'r3-gw',
    },
    {
      id: 'org-scribe',
      displayName: 'r5-scribe',
      model: 'qwen3.8-max',
      isDefault: false,
      role: '负责撰写与润色各类文档。',
      provider: 'r3-gw',
    },
    {
      id: 'org-scout',
      displayName: 'r9-scout',
      model: 'glm-5.3-flash',
      isDefault: false,
      role: null,
      provider: 'r3-gw',
    },
  ],
};

export const teamOrgChart: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_ORG_CHART,
  chief: {
    view: 'drawer',
    bound: true,
    agent: { id: 'org-chief', displayName: 'r3-builder', avatarUrl: null },
    threadTitle: '新主题',
  },
};

export const teamOrgChartEmpty: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: { members: 0, agents: [] },
};

const TEAM_ORG_CHART_SINGLE: TeamContent = {
  members: 1,
  agents: [
    {
      id: 'solo-chief',
      displayName: 'solo-root',
      model: 'claude-sonnet-5',
      isDefault: true,
      role: null,
      provider: 'r3-gw',
    },
  ],
};

export const teamOrgChartSingle: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_ORG_CHART_SINGLE,
  chief: {
    view: 'drawer',
    bound: true,
    agent: { id: 'solo-chief', displayName: 'solo-root', avatarUrl: null },
    threadTitle: '新主题',
  },
};

const TEAM_ORG_CHART_PAIR: TeamContent = {
  members: 2,
  agents: [
    {
      id: 'pair-chief',
      displayName: 'pair-root',
      model: 'claude-sonnet-5',
      isDefault: true,
      role: null,
      provider: 'r3-gw',
    },
    {
      id: 'pair-scribe',
      displayName: 'pair-child',
      model: 'qwen3.8-max',
      isDefault: false,
      role: null,
      provider: 'r3-gw',
    },
  ],
};

export const teamOrgChartPair: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_ORG_CHART_PAIR,
  chief: {
    view: 'drawer',
    bound: true,
    agent: { id: 'pair-chief', displayName: 'pair-root', avatarUrl: null },
    threadTitle: '新主题',
  },
};

export const teamRoster: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: {
    members: 4,
    agents: [
      {
        id: 'roster-builder',
        displayName: 'r3-builder',
        model: 'claude-sonnet-5',
        isDefault: true,
        machineId: MACHINE_ID,
        role: '负责代码实现与工程修改。',
        provider: 'r3-gw',
      },
      {
        id: 'roster-scribe',
        displayName: 'r5-scribe',
        model: 'claude-opus-4-5',
        isDefault: false,
        machineId: MACHINE_ID,
        role: '负责撰写与润色各类文档。',
        provider: 'r3-gw',
      },
      {
        id: 'roster-reviewer',
        displayName: 'r7-reviewer',
        model: 'claude-opus-4-5',
        isDefault: false,
        machineId: MACHINE_REMOTE_ID,
        role: '审阅合并请求并给出修改意见。',
        provider: 'claude-code',
      },
      {
        id: 'roster-scout',
        displayName: 'r9-scout',
        model: 'gpt-5.2',
        isDefault: false,
        machineId: null,
        role: null,
        provider: 'r3-gw',
      },
    ],
  },
  resources: {
    ...RESOURCES,
    machines: RESOURCES.machines.map((m) =>
      m.id === MACHINE_REMOTE_ID ? { ...m, online: false } : m,
    ),
  },
  chief: {
    view: 'none',
    bound: true,
    agent: { id: 'roster-builder', displayName: 'r3-builder', avatarUrl: null },
    threadTitle: '新主题',
  },
};

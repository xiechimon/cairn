import { boardDefault } from './board.js';
import { R3_BUILDER } from './core.js';
import type { FixtureSet, TeamContent } from './records.js';

/** Team route roster (r7 12): `1 个成员` stats bar + the single agent card
 *  (`claude-sonnet-5 · 默认`, role unset) beside the dashed 创建 Agent slot. */
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

/** Team route fixture (r7 12): the board todos never render here, the
 *  roster is the whole surface. */
export const teamGrid: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_R7,
};

/** chart 组织图 named scenario（命名场景无 capture 先例 #444）：r7 12 捕获
 *  只有一个成员，组织图的根/子结构在那份语料里长不出来——这里合成 3 个
 *  Agent + 1 个绑定总管，字段形状照 todos.dev 实测 members 行
 *  （displayName/provider/modelId/description）。供
 *  ./e2e/team-org-chart.spec.ts 钉组织图的结构与连接件几何。 */
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

/** 总管绑定在 org-chief 上 —— 组织图的根节点由它决定。 */
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

/** 零成员团队（r2 §8.1 17c：无成员时整块内容 = 暂无成员，不渲组织图）。 */
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

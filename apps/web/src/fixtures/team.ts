import { boardDefault } from './board.js';
import { R3_BUILDER } from './core.js';
import type { FixtureSet, TeamContent } from './records.js';

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

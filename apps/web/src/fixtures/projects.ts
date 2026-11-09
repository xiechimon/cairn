import { legacyDone, legacyReview, projectContent, r7 } from './core.js';
import type { FixtureSet } from './records.js';

export const projectFixture: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  project: projectContent,
};

export const projectTasksEmpty: FixtureSet = {
  todos: [],
  now: r7(13, 14),
  project: projectContent,
};

export const projectLocalTasks: FixtureSet = {
  ...projectFixture,
  project: {
    ...projectContent,
    repoKind: 'local',
    hosted: false,
    repoName: 'local-repo',
  },
};

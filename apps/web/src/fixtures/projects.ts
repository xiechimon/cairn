import { legacyDone, legacyReview, projectContent, r7 } from './core.js';
import type { FixtureSet } from './records.js';

export const projectFixture: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  project: projectContent,
};

export const projectTasks: FixtureSet = { ...projectFixture, projectTab: 'tasks' };

export const projectTasksEmpty: FixtureSet = {
  todos: [],
  now: r7(13, 14),
  project: projectContent,
  projectTab: 'tasks',
};

export const projectLocalFiles: FixtureSet = {
  todos: projectFixture.todos,
  now: projectFixture.now,
  project: {
    ...projectContent,
    repoKind: 'local',
    hosted: false,
    repoName: 'local-repo',
    branch: 'trunk',
    fileContents: {
      'README.md': [
        '# local-repo',
        '',
        '本地仓库：用户本机既有 git 工作树仓，Files tab 直读工作树 HEAD。',
        '',
      ].join('\n'),
    },
  },
  projectTab: 'files',
};

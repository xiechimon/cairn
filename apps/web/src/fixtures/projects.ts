import { legacyDone, legacyReview, projectContent, r7 } from './core.js';
import type { FixtureSet } from './records.js';

/** The project routes share one content set; the route picks the page and
 *  `projectTab` picks the 任务|文件 surface (r2 07 / 07e·24 / 24b·26 / 24c).
 *  Default tab = 文件 (r2 §2 route table). */
export const projectFixture: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  project: projectContent,
};

/** r2 26: 任务 tab with the two legacy rows (checkbox + title + rel time
 *  + owner avatar). */
export const projectTasks: FixtureSet = { ...projectFixture, projectTab: 'tasks' };

/** r2 24b: 任务 tab of a project without todos — the 暂无内容 empty state
 *  with the `+ 任务` entry (the r2 session's r2-inventory project). */
export const projectTasksEmpty: FixtureSet = {
  todos: [],
  now: r7(13, 14),
  project: projectContent,
  projectTab: 'tasks',
};

/** spec 12 / #362 G2-T2 v1: local 仓库项目的 文件 tab 禁用面（占位 +
 *  一行 disable 文案）；任务行 = legacy 双行（切换对照用）。 */
/** local 形态 Files 面演示集（scenario prj-local-files；#1030 起 Files tab
 * 开闸）：与 hosted 演示集（projectContent / r2 07e tree 面）同形，内容换
 * local 语义——本地仓 README、分支钉 trunk（local 仓默认分支任意，非恒
 * main）。 */
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
    commits: [
      {
        id: 'c1d2e3f4a5b60718293a4b5c6d7e8f90a1b2c3d4',
        shortSha: 'c1d2e3f',
        message: 'init local-repo',
        authorName: 'local-user',
        at: r7(10, 5),
        // #1102：根提交（无父）= 相对空树全文件新增（server readCommitDetail
        // S4 语义的 fixture 同形供肉）。
        files: [
          {
            path: 'README.md',
            additions: 3,
            deletions: 0,
            hunks: [
              {
                header: '@@ -0,0 +1,3 @@',
                lines: [
                  '+# local-repo',
                  '+',
                  '+本地仓库：用户本机既有 git 工作树仓，Files tab 直读工作树 HEAD。',
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  projectTab: 'files',
};

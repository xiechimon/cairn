import { chiefDraft } from './chief-draft.js';
import { legacyDone, PROJECT_ID, r7 } from './core.js';
import type { FixtureSet, TodoRecord } from './records.js';
import { RESOURCES } from './resources.js';

export const ARCHIVED_LANDING = 'sidebar-archived-landing';
export const ARCHIVED_ACME_V1 = 'sidebar-archived-acme-v1';
const ACTIVE_CAIRN = 'chief-draft-cairn';

const landingDone: TodoRecord = {
  ...legacyDone,
  id: 'sidebar-archived-landing-copy',
  seqNum: 21,
  title: '把落地页的首屏文案换成新版',
  spec: '把落地页的首屏文案换成新版',
  projectId: ARCHIVED_LANDING,
  phaseAt: r7(10, 40),
};

const base = chiefDraft.chief;

export const sidebarArchived: FixtureSet = {
  ...chiefDraft,
  todos: [landingDone, ...chiefDraft.todos],
  projectNames: { [ACTIVE_CAIRN]: 'cairn', [PROJECT_ID]: 'r3-lifecycle' },
  archivedProjects: [
    { id: ARCHIVED_LANDING, name: 'landing-page', archivedAt: r7(9, 30) },
    { id: ARCHIVED_ACME_V1, name: 'acme-api-v1', archivedAt: r7(8, 5) },
  ],
  projectGroups: { [ARCHIVED_ACME_V1]: '客户' },
  resources: RESOURCES,
  ...(base === undefined
    ? {}
    : {
        chief: {
          ...base,
          running: false,
          runningTool: undefined,
          stream: [
            ...(base.stream ?? []).filter((item) => item.kind !== 'streaming'),
            {
              kind: 'user',
              id: 'sidebar-archived-ask',
              text: '落地页的首屏文案换成新版，改完给我看看',
              createdAt: r7(10, 2),
              projectId: ARCHIVED_LANDING,
            },
            {
              kind: 'robot',
              id: 'sidebar-archived-reply',
              markdown:
                '首屏文案已经换成新版，标题改成「把重复的活交给 Coordinator」，副标题缩到一行。改动在任务 #21 里，已经合并。',
              seconds: '',
              createdAt: r7(10, 41),
              projectId: ARCHIVED_LANDING,
            },
          ],
        },
      }),
};

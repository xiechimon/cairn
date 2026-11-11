import { legacyReview, PROJECT_ID, probeTodo, r7 } from './core.js';
import type { FixtureSet, TodoRecord } from './records.js';
import { RESOURCES } from './resources.js';

const CAIRN_PROJECT = 'chief-draft-cairn';
const READ_REPO_ID = 'chief-draft-read-repo';

const readRepo: TodoRecord = {
  ...probeTodo('building', r7(11, 22)),
  id: READ_REPO_ID,
  seqNum: 12,
  title: '查看 cairn 仓库（测试）',
  spec: '查看 cairn 仓库（测试）',
  projectId: CAIRN_PROJECT,
  latestBuildId: `build-${READ_REPO_ID}`,
  section: 'working',
  owner: null,
};

export const chiefDraft: FixtureSet = {
  todos: [readRepo, legacyReview],
  now: r7(11, 22) + 42_000,
  projectNames: { [CAIRN_PROJECT]: 'cairn', [PROJECT_ID]: 'r3-lifecycle' },
  chief: {
    view: 'none',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: 'Coordinator',
    threadId: 'chief-global',
    running: true,
    runningTool: 'bash',
    stream: [
      {
        kind: 'robot',
        id: 'chief-draft-ask-name',
        markdown: 'cairn 的完整名字是什么，比如 用户名/cairn？',
        seconds: '',
        createdAt: r7(11, 10),
      },
      {
        kind: 'user',
        id: 'chief-draft-name',
        text: 'xiechimon/cairn，加吧',
        createdAt: r7(11, 11),
      },
      {
        kind: 'user',
        id: 'chief-draft-ask-read',
        text: '帮我看一遍这个仓库，建一个测试任务',
        createdAt: r7(11, 22),
      },
      {
        kind: 'robot',
        id: 'chief-draft-reply',
        markdown: `已把 xiechimon/cairn 加进来，测试任务 [查看 cairn 仓库（测试）](todo:${READ_REPO_ID}) 也建好了，正在读仓库。\n\n读完后我会汇报技术栈和最近的提交，你确认后再标记完成。`,
        seconds: '',
        createdAt: r7(11, 22) + 20_000,
      },
      { kind: 'streaming', seconds: 42, label: '处理中...' },
    ],
    quickReplies: ['好，等你汇报', '先只看 README'],
    context: { tokens: 24_000, contextWindow: 200_000 },
  },
};

const ACME_WEB = 'sidebar-ref-acme-web';
const ACME_API = 'sidebar-ref-acme-api';

const acmeReview: TodoRecord = {
  ...legacyReview,
  id: 'sidebar-ref-acme-review',
  seqNum: 14,
  title: '给 acme-api 的限流加一组回归测试',
  spec: '给 acme-api 的限流加一组回归测试',
  projectId: ACME_API,
  section: 'ready_for_review',
};

export const sidebarRef: FixtureSet = {
  ...chiefDraft,
  todos: [readRepo, acmeReview],
  projectNames: {
    [CAIRN_PROJECT]: 'cairn',
    [PROJECT_ID]: 'r3-lifecycle',
    [ACME_WEB]: 'acme-web',
    [ACME_API]: 'acme-api',
  },
  projectGroups: { [ACME_WEB]: '客户', [ACME_API]: '客户' },
  resources: RESOURCES,
};

import { boardDefault } from './board.js';
import { chiefDefault } from './chief.js';
import { at, probeTodo } from './core.js';
import type { ChiefContent, FixtureSet, TodoRecord, TranscriptItem } from './records.js';

const SHOP = 'readme-shop';
const AFFAIRS = 'readme-affairs';
const DAY = '2026-11-14';

const SECTION: Record<TodoRecord['phase'], Pick<TodoRecord, 'section' | 'owner'>> = {
  todo: { section: 'up_next', owner: null },
  queued: { section: 'working', owner: null },
  planning: { section: 'working', owner: null },
  building: { section: 'working', owner: null },
  confirm: { section: 'needs_input', owner: 'owner' },
  needs_input: { section: 'needs_input', owner: 'owner' },
  review: { section: 'ready_for_review', owner: 'owner' },
  failed: { section: 'working', owner: 'coordinator' },
  done: { section: 'resolved', owner: null },
  closed: { section: 'resolved', owner: null },
};

interface Copy {
  shop: string;
  affairs: string;
  askExport: string;
  replyExport: string;
  exportTitle: string;
  askMail: string;
  replyMail: string;
  mailTitle: string;
  question: {
    header: string;
    question: string;
    options: [string, string, string];
    notes: [string, string];
  };
  darkTitle: string;
  searchTitle: string;
  briefTitle: string;
  plan: { title: string; preview: string };
  steps: {
    search: string;
    read: [string, string, string];
    edit: string;
    test: string;
    testPurpose: string;
  };
  report: string;
}

const EN: Copy = {
  shop: 'Storefront',
  affairs: 'My affairs',
  askExport: 'Exporting orders takes 40 seconds on big stores. Make it fast.',
  replyExport:
    'Opened a thread on studio-linux. It read how three open-source shops export large tables and picked streaming.',
  exportTitle: 'Stream the order export',
  askMail: 'Draft a reply to the Acme interview invite. Tuesday afternoon works for me.',
  replyMail: 'The draft is ready in the thread. Nothing is sent until you say so.',
  mailTitle: 'Reply to the Acme interview invite',
  question: {
    header: 'Export limit',
    question: 'Streaming removes the need for the 50,000-row cap. Drop it?',
    options: ['Drop the cap', 'Keep 50,000 rows', 'Decide later'],
    notes: ['Medusa and Saleor both stream without a cap', 'Safer for slow disks'],
  },
  darkTitle: 'Dark mode for the settings page',
  searchTitle: 'Search in order history',
  briefTitle: 'Weekly calendar brief',
  plan: {
    title: 'Stream the order export',
    preview: 'Replace the in-memory CSV build with a streamed response; keep the column order.',
  },
  steps: {
    search: 'Search for export handlers',
    read: [
      'medusa/packages/core/order/export.ts',
      'saleor/csv/utils/export.py',
      'src/orders/export.ts',
    ],
    edit: 'src/orders/export.ts',
    test: 'pnpm test orders/export',
    testPurpose: 'Run the order export tests',
  },
  report: `The order export now streams rows as it reads them. A 120,000-order store exports in 3.1 s instead of 41 s, and memory stays under 60 MB.

## Decided myself

- Streaming over pagination. Medusa and Saleor both stream CSV; pagination would need a second endpoint and client changes.
- Node streams, no new library. \`node:stream\` covers it; \`csv-stringify\` would add a dependency for no gain.
- Kept the column order. Accounting imports the file by position.

## Needs your decision

1. Drop the 50,000-row cap? Streaming no longer needs it. Recommended: drop it.`,
};

const ZH: Copy = {
  shop: '网店',
  affairs: '我的事',
  askExport: '大店铺导出订单要 40 秒，弄快一点。',
  replyExport: '在 studio-linux 上开了一个 thread。它看了三个开源网店怎么导出大表，选了流式导出。',
  exportTitle: '订单导出改成流式',
  askMail: '帮我起草一封回复 Acme 面试邀请的邮件，周二下午我有空。',
  replyMail: '草稿在 thread 里，你说发才会发。',
  mailTitle: '回复 Acme 的面试邀请',
  question: {
    header: '导出上限',
    question: '改成流式以后，5 万行的上限就没必要了。要去掉吗？',
    options: ['去掉上限', '保留 5 万行', '以后再说'],
    notes: ['Medusa 和 Saleor 都是流式导出、不设上限', '磁盘慢时更稳妥'],
  },
  darkTitle: '设置页加暗色模式',
  searchTitle: '订单历史支持搜索',
  briefTitle: '每周日程简报',
  plan: {
    title: '订单导出改成流式',
    preview: '把一次性在内存里拼 CSV 改成边读边写的流式响应，列顺序不变。',
  },
  steps: {
    search: '搜索导出相关代码',
    read: [
      'medusa/packages/core/order/export.ts',
      'saleor/csv/utils/export.py',
      'src/orders/export.ts',
    ],
    edit: 'src/orders/export.ts',
    test: 'pnpm test orders/export',
    testPurpose: '跑订单导出的测试',
  },
  report: `订单导出改成了边读边写。12 万单的店铺导出从 41 秒降到 3.1 秒，内存一直在 60 MB 以下。

## 我已自行决定

- 用流式，不用分页。 Medusa 和 Saleor 都是流式导出 CSV；分页要多一个接口，前端也得改。
- 用 Node 自带的 stream，不加新库。 \`node:stream\` 就够用，加 \`csv-stringify\` 没有好处。
- 列顺序不变。 财务是按列位置导入这个文件的。

## 需要你定的

1. 去掉 5 万行上限吗？ 流式以后已经用不着它了。推荐：去掉。`,
};

function todo(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  projectId: string,
): TodoRecord {
  return {
    ...probeTodo(phase, at(DAY, 9, 40)),
    id,
    seqNum,
    title,
    spec: title,
    projectId,
    latestBuildId: phase === 'todo' ? null : `build-${id}`,
    ...SECTION[phase],
  };
}

function readmeFixture(copy: Copy): FixtureSet {
  const conversation: ChiefContent = {
    ...chiefDefault,
    view: 'none',
    bound: true,
    threadTitle: 'Coordinator',
    threadId: 'readme-chief',
    hasEarlier: false,
    stream: [
      { kind: 'user', id: 'readme-ask-export', text: copy.askExport, projectId: SHOP },
      {
        kind: 'robot',
        id: 'readme-reply-export',
        seconds: '',
        paragraphs: [[{ text: copy.replyExport }]],
      },
      {
        kind: 'task-card',
        id: 'readme-card-export',
        todoId: 'readme-export',
        projectId: SHOP,
        seq: 214,
        title: copy.exportTitle,
      },
      { kind: 'user', id: 'readme-ask-mail', text: copy.askMail, projectId: AFFAIRS },
      {
        kind: 'robot',
        id: 'readme-reply-mail',
        seconds: '',
        paragraphs: [[{ text: copy.replyMail }]],
      },
      {
        kind: 'task-card',
        id: 'readme-card-mail',
        todoId: 'readme-mail',
        projectId: AFFAIRS,
        seq: 31,
        title: copy.mailTitle,
      },
      {
        kind: 'question',
        id: 'readme-question',
        requestId: 'readme-q1',
        status: 'pending',
        answers: null,
        questions: [
          {
            header: copy.question.header,
            question: copy.question.question,
            options: [
              {
                label: copy.question.options[0],
                description: copy.question.notes[0],
                recommended: true,
              },
              { label: copy.question.options[1], description: copy.question.notes[1] },
              { label: copy.question.options[2], description: '' },
            ],
          },
        ],
      },
    ],
    streamAt: [
      at(DAY, 9, 30),
      at(DAY, 9, 31),
      at(DAY, 9, 31),
      at(DAY, 9, 50),
      at(DAY, 9, 52),
      at(DAY, 9, 52),
      at(DAY, 10, 20),
    ],
  };
  const exportTranscript: TranscriptItem[] = [
    { kind: 'user', text: copy.askExport, createdAt: at(DAY, 9, 31) },
    {
      kind: 'plan',
      title: copy.plan.title,
      preview: copy.plan.preview,
      seconds: 48,
      createdAt: at(DAY, 9, 33),
    },
    {
      kind: 'work',
      id: 'readme-work',
      expanded: true,
      createdAt: at(DAY, 9, 40),
      steps: [
        {
          kind: 'call',
          id: 's1',
          action: 'search',
          label: copy.steps.search,
          target: 'export',
          output: null,
          error: false,
          running: false,
          unfinished: false,
          seconds: 2,
        },
        ...copy.steps.read.map((target, index) => ({
          kind: 'call' as const,
          id: `r${index}`,
          action: 'read' as const,
          label: target,
          target,
          output: null,
          error: false,
          running: false,
          unfinished: false,
          seconds: 1,
        })),
        {
          kind: 'call',
          id: 'e1',
          action: 'edit',
          label: copy.steps.edit,
          target: copy.steps.edit,
          diff: { added: 64, removed: 41 },
          output: null,
          error: false,
          running: false,
          unfinished: false,
          seconds: 3,
        },
        {
          kind: 'call',
          id: 't1',
          action: 'run',
          label: copy.steps.test,
          command: copy.steps.test,
          description: copy.steps.testPurpose,
          output: '18 passed',
          error: false,
          running: false,
          unfinished: false,
          seconds: 14,
        },
      ],
    },
    { kind: 'report', id: 'readme-report', markdown: copy.report, createdAt: at(DAY, 10, 19) },
  ];
  return {
    ...boardDefault,
    resources: {
      skills: [],
      mcpServers: [],
      providerSources: [],
      machines: [
        {
          id: 'readme-studio',
          kind: 'remote',
          name: 'studio-linux',
          online: true,
          chiefHost: true,
          runningSteps: 1,
          maxConcurrent: 8,
        },
        {
          id: 'readme-laptop',
          kind: 'local',
          name: 'MacBook Air',
          online: true,
          runningSteps: 0,
          maxConcurrent: 4,
        },
      ],
    },
    projectNames: { [SHOP]: copy.shop, [AFFAIRS]: copy.affairs },
    todos: [
      todo('readme-export', 214, copy.exportTitle, 'review', SHOP),
      todo('readme-mail', 31, copy.mailTitle, 'needs_input', AFFAIRS),
      todo('readme-dark', 215, copy.darkTitle, 'building', SHOP),
      todo('readme-search', 216, copy.searchTitle, 'todo', SHOP),
      todo('readme-brief', 30, copy.briefTitle, 'done', AFFAIRS),
    ],
    chief: conversation,
    chiefChannels: {
      [SHOP]: {
        ...conversation,
        threadTitle: copy.shop,
        threadId: 'readme-chief-shop',
        stream: [0, 1, 2, 6]
          .map((index) => (conversation.stream ?? [])[index])
          .filter((item) => item !== undefined),
        streamAt: [at(DAY, 9, 30), at(DAY, 9, 31), at(DAY, 9, 31), at(DAY, 10, 20)],
      },
    },
    details: { 'readme-export': { transcript: exportTranscript } },
    now: at(DAY, 10, 21),
  };
}

export const readmeEn: FixtureSet = readmeFixture(EN);
export const readmeZh: FixtureSet = readmeFixture(ZH);

import { legacyDone, legacyReview, MACHINE_NAME, r7 } from './core.js';
import type {
  ChiefContent,
  ChiefExample,
  ChiefSettingsTab,
  ChiefStreamItem,
  ChiefThreadRef,
  FixtureSet,
} from './records.js';

export const CHIEF_EXAMPLES: ChiefExample[] = [
  { icon: 'user-plus', text: '帮我组建 Agent 团队' },
  { icon: 'folder', text: '帮我创建一个新项目' },
  { icon: 'grid', text: '总结一下我所有项目现在的进展' },
  { icon: 'bars', text: '查一下这个月的 token 用量' },
];

const CHIEF_DRAFT =
  '我想做一个能在浏览器里直接玩的网页小游戏 （比如贪吃蛇或打砖块）： 单文件 HTML + Canvas， 不用任何构建工具，做完能在项目的文件页直接试玩。请在现有的入门项目里做， 组建 Agent 团队把游戏逻辑、 画面手感、 难度调优拆成并行任务， 然后向我汇报方案， 等我确认后再开始动工。';

const CHIEF_THREADS: ChiefThreadRef[] = [
  { title: '给 r3-lifecycle 做三件小事…', active: true },
  { title: '帮 r3-lifecycle 写一份…' },
];

export const chiefGated: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: false,
    threadTitle: '新主题',
    examples: CHIEF_EXAMPLES,
    draft: CHIEF_DRAFT,
  },
};

export const chiefReady: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '新主题',
    examples: CHIEF_EXAMPLES,
    draft: CHIEF_DRAFT,
  },
};

export const chiefStreaming: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '我想做一个能在浏览器里直…',
    running: true,
    stream: [
      { kind: 'note', text: '17:19' },
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      { kind: 'user', text: CHIEF_DRAFT },
      {
        kind: 'robot',
        paragraphs: [
          [
            {
              text: '收到。我先读一遍现有入门项目的结构，再把游戏逻辑、画面手感、难度调优拆成并行任务向你汇报方案。',
            },
          ],
        ],
        seconds: '',
        tools: [{ label: 'git show' }],
      },
    ],
  },
};

export const chiefThread: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '帮 r3-lifecycle 写一份…',
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      {
        kind: 'user',
        text: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南，说明怎么给 Agent 提任务、怎么验收改动，写完放到项目根目录。',
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '已创建并派工 ' },
            { text: '', todo: 11 },
            { text: ' 「编写 CONTRIBUTING.md 贡献指南」， 由文档专职 Agent ' },
            { text: '', agent: 'r5-scribe' },
            { text: ' 承接，正在编写中。' },
          ],
          [
            {
              text: '要求内容涵盖：如何给 Agent 提任务、如何验收改动，文件写入项目根目录 CONTRIBUTING.md。完成或需要确认时我会跟进汇报。',
            },
          ],
        ],
        seconds: '44s',
        tools: [
          { label: 'create_todo', seconds: 2 },
          { label: 'run_builds', seconds: 5 },
        ],
      },
    ],
  },
};

export const chiefThreadsOpen: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    threadsOpen: true,
    threads: CHIEF_THREADS,
    stream: [
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '顺带说明： CONTRIBUTING.md 本身由 ' },
            { text: '', todo: 11 },
            {
              text: ' 负责编写，目前在 review 阶段尚未合并进 main，我在新任务里已注明"只需在 README 里列出该条目，不必等它合并"。',
            },
          ],
          [{ text: '等它落到 review/完成时我会来汇报，到时候也会补上记忆总结。' }],
        ],
        seconds: '1m 4s',
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '三项改动都已核对，符合要求：' }]],
        bullets: [
          [
            { text: 'README.md:', strong: true },
            { text: '新增 「文档目录」 节，列出 ' },
            { text: 'CONTRIBUTING.md', code: true },
            { text: ' 链接。' },
          ],
          [
            { text: 'CHANGELOG.md:', strong: true },
            { text: '新建,含 「未发布」 初始条目，列出本次三项变更。' },
          ],
          [
            { text: 'scripts/hello.js:', strong: true },
            { text: 'node scripts/hello.js', code: true },
            { text: ' 打印 ' },
            { text: 'hello', code: true },
            { text: '，构建里已本地验证过。' },
          ],
        ],
        seconds: '31s',
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '', todo: 12 },
            { text: ' 现在停在 review 阶段等你确认合并。要我现在 merge 吗?' },
          ],
        ],
        seconds: '31s',
      },
    ],
  },
};

const CHIEF_THREADS_LONG: ChiefThreadRef[] = [
  ...CHIEF_THREADS,
  ...Array.from({ length: 20 }, (_, i) => ({ title: `长列表主题 ${i + 1}` })),
];

export const chiefThreadsLong: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    threadsOpen: true,
    threads: CHIEF_THREADS_LONG,
    stream: [
      {
        kind: 'robot',
        paragraphs: [[{ text: '三项改动都已核对，符合要求：' }]],
        seconds: '31s',
      },
    ],
  },
};

const CHIEF_SCROLL_ROWS: ChiefStreamItem[] = Array.from({ length: 40 }, (_, i) =>
  i % 2 === 0
    ? { kind: 'user', text: `滚动保留探针第 ${i + 1} 条：检查最小化后滚动位置是否存活。` }
    : {
        kind: 'robot',
        paragraphs: [
          [
            {
              text: `第 ${i + 1} 条回执：这条只负责撑高消息流，让滚动位置有可测的中间值；内容本身不参与任何断言。`,
            },
          ],
        ],
        seconds: '10s',
      },
);

export const chiefScrollLong: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '滚动保留探针…',
    stream: CHIEF_SCROLL_ROWS,
  },
};

const CHIEF_MD_REPLY = [
  '## 凭证链路验证报告',
  '',
  '三项检查已完成，**全部通过**，输出细节在 `docs/verify/` 目录。',
  '',
  '- **项目**: 凭证链路验证',
  '- 次要点: 由 [r5-scribe](agent:a1) 承接复核',
  '- 关联任务: [#1](todo:r3-legacy-1) 已进入复核；prose #12 与 [伪链](todos:t2) 保持字面',
  '',
  '1. 第一步：读取配置',
  '   - 子项：token 门',
  '2. 第二步：跑通探针',
  '',
  '```sh',
  'curl -s localhost:8787/healthz',
  '```',
].join('\n');

export const chiefMarkdown: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '验证一下凭证链路…',
    running: true,
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'user', text: '验证一下凭证链路，然后给我一份报告' },
      {
        kind: 'robot',
        markdown: CHIEF_MD_REPLY,
        seconds: '44s',
      },
      {
        kind: 'robot',
        markdown: '正在复核 **relay 通道** 的重试预算',
        typing: true,
        seconds: '',
      },
    ],
  },
};

export const chiefQuestion: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给贪吃蛇小游戏定难度…',
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'user', text: '给贪吃蛇小游戏定一下难度曲线，拆好任务再开工。' },
      {
        kind: 'question',
        id: 'q-answered',
        requestId: 'q-answered',
        status: 'answered',
        questions: [
          {
            header: '目标平台',
            question: '先做哪一端？',
            options: [{ label: '桌面浏览器' }, { label: '手机浏览器' }],
          },
        ],
        answers: [{ header: '目标平台', choices: ['桌面浏览器'] }],
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '好，先做桌面端。难度还需要你定两件事：' }]],
        seconds: '12s',
      },
      {
        kind: 'question',
        id: 'q-pending',
        requestId: 'q-pending',
        status: 'pending',
        questions: [
          {
            header: '难度曲线',
            question: '蛇速随分数怎么涨？',
            options: [
              { label: '每 50 分加速一档' },
              { label: '每吃 5 个果子加速一档' },
              { label: '保持匀速，只加障碍' },
            ],
          },
          { header: '上限', question: '最高速度给多少格每秒？', options: [] },
        ],
        answers: null,
      },
    ],
  },
};

export function chiefSettings(tab: ChiefSettingsTab): FixtureSet {
  return {
    todos: [legacyReview, legacyDone],
    now: r7(13, 14),
    chief: { view: 'settings', tab, bound: false, threadTitle: '新主题' },
  };
}

export const chiefDefault: ChiefContent = {
  view: 'drawer',
  bound: false,
  threadTitle: '新主题',
  examples: CHIEF_EXAMPLES,
};

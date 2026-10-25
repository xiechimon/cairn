import {
  at,
  legacyDone,
  legacyReview,
  MACHINE_NAME,
  PROJECT_ID,
  R3_BUILDER,
  r8,
  TEAM_ID,
} from './core.js';
import type { DocBlock, FixtureSet, TodoRecord, TranscriptItem } from './records.js';

function dyn15(phase: TodoRecord['phase']): TodoRecord {
  return {
    id: 'r8-dynamic-15',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: '在 README.md 末尾追加一行「r8 dynamic probe」',
    spec: '在 README.md 末尾追加一行「r8 dynamic probe」',
    phase,
    phaseAt: r8(23, 39),
    seqNum: 15,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: 'r8-dynamic-conv-15',
    lastRunAt: r8(23, 39),
    hasChanges: false,
    hasPlan: false,
    buildHistory: [{ buildId: 'r8-dynamic-conv-15', createdAt: r8(23, 39) }],
    sourceTodo: null,
    v: 2,
  };
}

const dyn12Failed: TodoRecord = {
  id: 'r8-dynamic-12',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  spec: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  phase: 'failed',
  phaseAt: r8(18, 44),
  seqNum: 12,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r8-dynamic-conv-12',
  lastRunAt: r8(18, 44),
  hasChanges: false,
  hasPlan: false,
  buildHistory: [{ buildId: 'r8-dynamic-conv-12', createdAt: r8(18, 40) }],
  sourceTodo: null,
  v: 3,
};

function dynLeftover(
  seq: number,
  title: string,
  phase: TodoRecord['phase'],
  hoursAgo: number,
): TodoRecord {
  return {
    id: `r8-dynamic-${seq}`,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title,
    spec: title,
    phase,
    phaseAt: r8(23 - hoursAgo, 44),
    seqNum: seq,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: `r8-dynamic-conv-${seq}`,
    lastRunAt: r8(23 - hoursAgo, 44),
    hasChanges: phase === 'review' || phase === 'done',
    hasPlan: phase === 'review',
    buildHistory: [{ buildId: `r8-dynamic-conv-${seq}`, createdAt: r8(23 - hoursAgo, 40) }],
    sourceTodo: null,
    v: 3,
  };
}

const R8_LEFTOVERS = [
  dynLeftover(13, '给 README.md 增加「项目结构」一节并链接贡献指南', 'review', 6),
  dynLeftover(14, '给 index.html 的页面标题加上项目名后缀', 'done', 6),
  dynLeftover(11, '编写 CONTRIBUTING.md 贡献指南', 'done', 6),
];

function probe16(phase: TodoRecord['phase'], phaseAt: number): TodoRecord {
  return {
    id: 'u_B5ngeVOlKdKbG_4H9Cl',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: 'r8-overlay-dark 探针',
    spec: 'r8-overlay-dark 探针',
    phase,
    phaseAt,
    seqNum: 16,
    orderIndex: 0,
    tagIds: [],
    assignment: phase === 'todo' ? null : { agentId: R3_BUILDER.id },
    agent: phase === 'todo' ? null : R3_BUILDER,
    latestBuildId: phase === 'todo' ? null : R8_BUILD_ID,
    lastRunAt: phase === 'todo' ? null : r8(23, 43),
    hasChanges: false,
    hasPlan: phase === 'confirm',
    buildHistory: phase === 'todo' ? [] : [{ buildId: R8_BUILD_ID, createdAt: r8(23, 43) }],
    sourceTodo: null,
    v: 2,
  };
}

const R8_BUILD_ID = 'r8-conv-overlay-16';

const R8_PLAN_DOC: DocBlock[] = [
  { kind: 'head', segments: [{ text: 'Context' }] },
  {
    kind: 'para',
    segments: [
      { text: 'r3-lifecycle 是一个纯静态单页仓库（' },
      { text: 'index.html', style: 'link' },
      { text: ' + ' },
      { text: 'README.md', style: 'link' },
      { text: '，无构建/测试/CI）。历史上每一轮 rN 探针任务（r3、r5b、r6、r7，见 ' },
      { text: 'README.md', style: 'link' },
      { text: ' 现有内容及对应 commit ' },
      { text: '2f47b62', style: 'link' },
      { text: '、' },
      { text: '386b8e4', style: 'link' },
      { text: '、' },
      { text: '1cecf83', style: 'link' },
      { text: '、' },
      { text: '2cceb9d', style: 'link' },
      { text: '）都遵循同一套路：在 ' },
      { text: 'README.md', style: 'link' },
      { text: ' 末尾追加一行 "' },
      { text: '<探针名> probe', style: 'link' },
      { text: '" 文本，作为该轮次生命周期/rebaseline 探针的可验证产物，commit message 统一为 ' },
      { text: 'docs(readme): append <探针名> probe line', style: 'link' },
      { text: '。本次任务 ' },
      { text: 'r8-overlay-dark 探针', style: 'link' },
      {
        text: ' 的 Spec 未给出具体文案，按同一约定执行：追加对应的第 r8 轮探针行，保持仓库内探针记录的连续性。',
      },
    ],
  },
  { kind: 'head', segments: [{ text: '假设' }] },
  {
    kind: 'bullet',
    segments: [
      { text: 'Spec 为空，按仓库既有 r3/r5b/r6/r7 探针的命名与格式惯例，在 ' },
      { text: 'README.md', style: 'link' },
      { text: ' 末尾新增一行：' },
      { text: 'r8 overlay-dark probe', style: 'link' },
      { text: '（对应标题中的 ' },
      { text: 'r8-overlay-dark', style: 'link' },
      { text: '，与既有行如 ' },
      { text: 'r7 rebaseline probe', style: 'link' },
      { text: ' 的措辞风格一致）。' },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      { text: '不改动 ' },
      { text: 'index.html', style: 'link' },
      { text: '、' },
      { text: 'CONTRIBUTING.md', style: 'link' },
      { text: '，本轮探针只涉及 ' },
      { text: 'README.md', style: 'link' },
      { text: '。' },
    ],
  },
  { kind: 'head', segments: [{ text: 'Changes' }] },
  {
    kind: 'bullet',
    segments: [
      { text: 'README.md', style: 'link' },
      { text: '：在文件末尾追加一行 ' },
      { text: 'r8 overlay-dark probe', style: 'link' },
      { text: '，与现有 5 行探针记录（' },
      { text: 'r3 lifecycle probe', style: 'link' },
      { text: ' 等）保持相同的纯文本追加方式，不改动已有内容、不加空行。' },
    ],
  },
  { kind: 'head', segments: [{ text: 'Verification' }] },
  {
    kind: 'bullet',
    segments: [
      { text: 'git diff README.md', style: 'code' },
      { text: ' 确认只新增一行 ' },
      { text: 'r8 overlay-dark probe', style: 'link' },
      { text: '，无其他改动。' },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      { text: 'git log --oneline -1', style: 'code' },
      { text: ' 确认提交信息符合约定：' },
      { text: 'docs(readme): append r8 overlay-dark probe line', style: 'link' },
      { text: '。' },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      {
        text: '用变更审阅（change review）里 README.md 的预览按钮确认渲染正常、新行显示在列表末尾。',
      },
    ],
  },
];

const R8_CONFIRM_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '23:43', machine: MACHINE_NAME },
  { kind: 'user', text: '开始执行任务', seq: 16, title: 'r8-overlay-dark 探针' },
  {
    kind: 'robot',
    paragraphs: [
      [
        {
          text: '该任务的 Spec 为空，只有标题「r8-overlay-dark 探针」。参照仓库里 r3~r7 同类型探针 commit（如 ',
        },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        {
          text: '）的固定套路——在 README.md 末尾追加一行与探针名对应的文本——我按同一约定生成本次改动的具体文案，并在计划中的「假设」里写明。',
        },
      ],
    ],
  },
  {
    kind: 'plan',
    title: '方案 · v1',
    preview:
      'Context r3-lifecycle 是一个纯静态单页仓库（index.html + README.md，无构建/测试/CI）。历史上每一轮 rN 探针任务（r3、r5b、r6、r7，见 README.md 现有内容及对应 commit 2f47b62、386b8e4、1cecf83、2cceb9d）都遵循…',
    seconds: 161,
  },
];

export const boardR8Overlay: FixtureSet = {
  todos: [dyn15('planning'), dyn12Failed, legacyReview, ...R8_LEFTOVERS, legacyDone],
  now: r8(23, 44),
  usageNav: true,
};

export const detailR8Fresh: FixtureSet = {
  todos: [
    probe16('todo', r8(23, 42)),
    dyn15('confirm'),
    dyn12Failed,
    legacyReview,
    ...R8_LEFTOVERS,
    legacyDone,
  ],
  now: r8(23, 43),
  usageNav: true,
};

const probe17Fresh: TodoRecord = {
  id: 'r8-delete-17',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'r8-delete-dark 探针',
  spec: 'r8-delete-dark 探针',
  phase: 'todo',
  phaseAt: at('2026-09-23', 0, 34),
  seqNum: 17,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: null,
  lastRunAt: null,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 2,
};

export const detailR8DeleteFresh: FixtureSet = {
  todos: [probe17Fresh, dyn15('done'), dyn12Failed, legacyReview, ...R8_LEFTOVERS, legacyDone],
  now: at('2026-09-23', 0, 35),
  usageNav: true,
};

export function detailR8Confirm(): FixtureSet {
  return {
    todos: [
      probe16('confirm', r8(23, 43)),
      dyn15('confirm'),
      dyn12Failed,
      legacyReview,
      ...R8_LEFTOVERS,
      legacyDone,
    ],
    now: r8(23, 44),
    usageNav: true,
    detail: { transcript: R8_CONFIRM_TRANSCRIPT, doc: R8_PLAN_DOC },
  };
}
